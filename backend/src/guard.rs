//! Abuse guards for a public, un-authed endpoint. Everything here is in-memory
//! and best-effort — it sheds load from a single source (accidental or hostile)
//! so one client can't deny the service to everyone. A serious DDoS is still the
//! edge's job (see the deploy notes); this is defense-in-depth so the app holds
//! up even when deployed with no proxy in front.
//!
//! Three levers, all keyed on the client IP:
//! - a per-IP token bucket on room creation + join ([`RateMap`]),
//! - a per-IP + global cap on concurrent WebSockets ([`Guard::try_ws`]),
//! - a per-connection inbound message budget ([`ConnLimiter`], used in `ws.rs`).
//!
//! Resolving the client IP correctly is the crux — see [`ClientIp`].

use std::collections::HashMap;
use std::convert::Infallible;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Mutex;
use std::time::Instant;

use axum::extract::{ConnectInfo, FromRequestParts};
use axum::http::request::Parts;

use crate::config::Config;
use crate::AppState;

/// Cap on distinct IPs tracked by a [`RateMap`] — bounds the map's own memory so
/// a flood of unique sources can't grow it without limit. Full (idle) buckets
/// are swept out periodically; once truly saturated, new IPs are denied.
const MAX_TRACKED_IPS: usize = 200_000;

/// The resolved client IP, for per-IP abuse limits.
///
/// **Trust model** (`cfg.trust_proxy`): the `X-Forwarded-For` / `X-Real-IP`
/// headers are attacker-controlled unless a trusted proxy sets them, so we only
/// read them when explicitly told a proxy is in front. With one trusted hop
/// (Traefik/nginx), the proxy's `X-Real-IP` — or the *rightmost* `X-Forwarded-For`
/// entry it appended — is the real client. When not trusting a proxy we use the
/// TCP peer address (from `ConnectInfo`), which can't be spoofed. Getting this
/// wrong either collapses every client into one bucket (proxy, trust off) or lets
/// anyone forge their IP to dodge limits (no proxy, trust on).
#[derive(Debug, Clone, Copy)]
pub struct ClientIp(pub IpAddr);

impl FromRequestParts<AppState> for ClientIp {
    type Rejection = Infallible;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        Ok(ClientIp(resolve_ip(
            &parts.headers,
            parts
                .extensions
                .get::<ConnectInfo<SocketAddr>>()
                .map(|c| c.0),
            state.cfg.trust_proxy,
        )))
    }
}

/// Pure IP resolution, factored out for testing. See [`ClientIp`] for the model.
pub fn resolve_ip(
    headers: &axum::http::HeaderMap,
    peer: Option<SocketAddr>,
    trust_proxy: bool,
) -> IpAddr {
    if trust_proxy {
        if let Some(ip) = headers
            .get("x-real-ip")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.trim().parse().ok())
        {
            return ip;
        }
        // XFF is "client, proxy1, proxy2, ..."; with one trusted hop the entry
        // our proxy appended (the real peer) is the LAST one. Earlier entries
        // may be client-forged, so never trust the leftmost.
        if let Some(ip) = headers
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.rsplit(',').next())
            .and_then(|s| s.trim().parse().ok())
        {
            return ip;
        }
    }
    peer.map(|p| p.ip())
        .unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED))
}

/// A refilling token bucket.
struct Bucket {
    tokens: f64,
    last: Instant,
}

/// Per-IP token-bucket rate limiter. `capacity` tokens, refilling at
/// `refill_per_sec`; each allowed request spends one. A first-seen IP starts
/// full, so a burst up to `capacity` is allowed, then throttled to the refill
/// rate.
pub struct RateMap {
    capacity: f64,
    refill_per_sec: f64,
    map: Mutex<HashMap<IpAddr, Bucket>>,
}

impl RateMap {
    /// `per_min` requests/minute sustained, with a burst of the same size.
    pub fn per_minute(per_min: u32) -> Self {
        let per_min = per_min.max(1) as f64;
        RateMap {
            capacity: per_min,
            refill_per_sec: per_min / 60.0,
            map: Mutex::new(HashMap::new()),
        }
    }

    pub fn allow(&self, ip: IpAddr) -> bool {
        self.allow_at(ip, Instant::now())
    }

    fn allow_at(&self, ip: IpAddr, now: Instant) -> bool {
        let mut map = self.map.lock().unwrap();
        // Bound the map's own size: once saturated with distinct IPs, deny new
        // ones (known IPs still tracked). The sweep below keeps this from
        // sticking once a flood subsides.
        if !map.contains_key(&ip) && map.len() >= MAX_TRACKED_IPS {
            return false;
        }
        let b = map.entry(ip).or_insert(Bucket {
            tokens: self.capacity,
            last: now,
        });
        let elapsed = now.saturating_duration_since(b.last).as_secs_f64();
        b.tokens = (b.tokens + elapsed * self.refill_per_sec).min(self.capacity);
        b.last = now;
        if b.tokens >= 1.0 {
            b.tokens -= 1.0;
            true
        } else {
            false
        }
    }

    /// Drop buckets that have fully refilled (idle) — they carry no state, so
    /// forgetting them is free and keeps the map bounded.
    fn sweep_at(&self, now: Instant) {
        let mut map = self.map.lock().unwrap();
        map.retain(|_ip, b| {
            let elapsed = now.saturating_duration_since(b.last).as_secs_f64();
            (b.tokens + elapsed * self.refill_per_sec) < self.capacity
        });
    }
}

/// Concurrent-WebSocket accounting: per-IP counts + a running total.
struct WsTrack {
    per_ip: HashMap<IpAddr, u32>,
    total: usize,
}

/// The bundle of per-IP abuse limiters, shared via `AppState`.
pub struct Guard {
    pub create: RateMap,
    pub join: RateMap,
    ws_per_ip: u32,
    max_ws: usize,
    ws_msgs_per_sec: u32,
    ws: Mutex<WsTrack>,
}

impl Guard {
    pub fn from_cfg(cfg: &Config) -> Self {
        Guard {
            create: RateMap::per_minute(cfg.create_per_min),
            join: RateMap::per_minute(cfg.join_per_min),
            ws_per_ip: cfg.ws_per_ip,
            max_ws: cfg.max_ws,
            ws_msgs_per_sec: cfg.ws_msgs_per_sec,
            ws: Mutex::new(WsTrack {
                per_ip: HashMap::new(),
                total: 0,
            }),
        }
    }

    /// Reserve a WebSocket slot for `ip`. `Some(permit)` grants it; the count is
    /// released when the permit drops. `None` = at the per-IP or global cap.
    pub fn try_ws(self: &std::sync::Arc<Self>, ip: IpAddr) -> Option<WsPermit> {
        let mut t = self.ws.lock().unwrap();
        if t.total >= self.max_ws {
            return None;
        }
        let n = t.per_ip.entry(ip).or_insert(0);
        if *n >= self.ws_per_ip {
            return None;
        }
        *n += 1;
        t.total += 1;
        Some(WsPermit {
            guard: self.clone(),
            ip,
        })
    }

    /// A fresh per-connection message limiter using the configured budget.
    pub fn conn_limiter(&self) -> ConnLimiter {
        ConnLimiter::new(self.ws_msgs_per_sec)
    }

    /// Periodic maintenance: drop idle rate-limit buckets.
    pub fn sweep(&self) {
        let now = Instant::now();
        self.create.sweep_at(now);
        self.join.sweep_at(now);
    }
}

/// RAII slot for one live WebSocket; decrements the per-IP + global counts on
/// drop, so a dropped/aborted socket always frees its slot.
pub struct WsPermit {
    guard: std::sync::Arc<Guard>,
    ip: IpAddr,
}

impl Drop for WsPermit {
    fn drop(&mut self) {
        let mut t = self.guard.ws.lock().unwrap();
        if let Some(n) = t.per_ip.get_mut(&self.ip) {
            *n -= 1;
            if *n == 0 {
                t.per_ip.remove(&self.ip);
            }
        }
        t.total = t.total.saturating_sub(1);
    }
}

/// What to do with an inbound WebSocket message under the per-connection budget.
#[derive(Debug, PartialEq, Eq)]
pub enum MsgVerdict {
    /// Within budget — process it.
    Ok,
    /// Over budget — ignore this message (drop the amplification, keep the peer).
    Drop,
    /// Sustained flooding — close the connection.
    Close,
}

/// A per-connection inbound-message token bucket. Not shared: each socket owns
/// one. Bursts up to `2×per_sec`, refills at `per_sec`. Sustained over-budget
/// traffic (a run of `2×per_sec` dropped messages) trips [`MsgVerdict::Close`].
pub struct ConnLimiter {
    tokens: f64,
    capacity: f64,
    refill_per_sec: f64,
    last: Instant,
    strikes: u32,
    strike_limit: u32,
}

impl ConnLimiter {
    pub fn new(per_sec: u32) -> Self {
        let per_sec = per_sec.max(1);
        let capacity = (per_sec * 2) as f64;
        ConnLimiter {
            tokens: capacity,
            capacity,
            refill_per_sec: per_sec as f64,
            last: Instant::now(),
            strikes: 0,
            strike_limit: per_sec * 2,
        }
    }

    pub fn check(&mut self) -> MsgVerdict {
        self.check_at(Instant::now())
    }

    fn check_at(&mut self, now: Instant) -> MsgVerdict {
        let elapsed = now.saturating_duration_since(self.last).as_secs_f64();
        self.tokens = (self.tokens + elapsed * self.refill_per_sec).min(self.capacity);
        self.last = now;
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            self.strikes = 0;
            MsgVerdict::Ok
        } else {
            self.strikes += 1;
            if self.strikes > self.strike_limit {
                MsgVerdict::Close
            } else {
                MsgVerdict::Drop
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderMap;
    use std::time::Duration;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn peer_ip_used_when_not_trusting_proxy() {
        let mut h = HeaderMap::new();
        h.insert("x-forwarded-for", "9.9.9.9".parse().unwrap());
        let peer: SocketAddr = "1.2.3.4:5555".parse().unwrap();
        // Header ignored — a direct client can't spoof its way to a new bucket.
        assert_eq!(resolve_ip(&h, Some(peer), false), ip("1.2.3.4"));
    }

    #[test]
    fn xreal_and_xff_used_when_trusting_proxy() {
        let peer: SocketAddr = "10.0.0.1:5555".parse().unwrap(); // the proxy
        let mut h = HeaderMap::new();
        h.insert("x-real-ip", "8.8.8.8".parse().unwrap());
        assert_eq!(resolve_ip(&h, Some(peer), true), ip("8.8.8.8"));

        // No X-Real-IP → take the rightmost (proxy-appended) XFF entry, not the
        // client-forgeable leftmost.
        let mut h2 = HeaderMap::new();
        h2.insert("x-forwarded-for", "1.1.1.1, 8.8.4.4".parse().unwrap());
        assert_eq!(resolve_ip(&h2, Some(peer), true), ip("8.8.4.4"));
    }

    #[test]
    fn rate_map_bursts_then_throttles() {
        let rm = RateMap::per_minute(5); // capacity 5
        let t0 = Instant::now();
        let who = ip("1.2.3.4");
        // Burst of 5 allowed, 6th denied.
        for _ in 0..5 {
            assert!(rm.allow_at(who, t0));
        }
        assert!(!rm.allow_at(who, t0));
        // A different IP has its own bucket.
        assert!(rm.allow_at(ip("5.6.7.8"), t0));
        // After ~12s one token (5/min) has refilled.
        assert!(rm.allow_at(who, t0 + Duration::from_secs(13)));
        assert!(!rm.allow_at(who, t0 + Duration::from_secs(13)));
    }

    #[test]
    fn rate_map_sweep_drops_idle_buckets() {
        let rm = RateMap::per_minute(60);
        let t0 = Instant::now();
        assert!(rm.allow_at(ip("1.2.3.4"), t0));
        assert_eq!(rm.map.lock().unwrap().len(), 1);
        // Well after full refill, the bucket is idle → swept.
        rm.sweep_at(t0 + Duration::from_secs(120));
        assert_eq!(rm.map.lock().unwrap().len(), 0);
    }

    #[test]
    fn conn_limiter_drops_then_closes() {
        let mut cl = ConnLimiter::new(2); // capacity 4, close after >4 strikes
        let t0 = Instant::now();
        // Spend the burst.
        for _ in 0..4 {
            assert_eq!(cl.check_at(t0), MsgVerdict::Ok);
        }
        // Next few over-budget messages are dropped...
        for _ in 0..4 {
            assert_eq!(cl.check_at(t0), MsgVerdict::Drop);
        }
        // ...sustained flooding trips a close.
        assert_eq!(cl.check_at(t0), MsgVerdict::Close);
    }

    #[test]
    fn ws_permits_cap_per_ip_and_release_on_drop() {
        use std::sync::Arc;
        let mut cfg = Config::from_env().unwrap();
        cfg.ws_per_ip = 2;
        cfg.max_ws = 100;
        let g = Arc::new(Guard::from_cfg(&cfg));
        let who = ip("1.2.3.4");
        let p1 = g.try_ws(who);
        let p2 = g.try_ws(who);
        assert!(p1.is_some() && p2.is_some());
        assert!(g.try_ws(who).is_none()); // at the per-IP cap
        drop(p1);
        assert!(g.try_ws(who).is_some()); // slot freed
    }

    #[test]
    fn ws_permits_cap_global_total() {
        use std::sync::Arc;
        let mut cfg = Config::from_env().unwrap();
        cfg.ws_per_ip = 100;
        cfg.max_ws = 1;
        let g = Arc::new(Guard::from_cfg(&cfg));
        let p1 = g.try_ws(ip("1.1.1.1"));
        assert!(p1.is_some());
        assert!(g.try_ws(ip("2.2.2.2")).is_none()); // global cap hit
    }
}
