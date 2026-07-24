//! Opt-in OpenTelemetry METRICS export (usage counters — games, joins, rolls,
//! live rooms/sockets), configured ENTIRELY by the standard `OTEL_*` env vars:
//! export is active only when `OTEL_EXPORTER_OTLP_ENDPOINT` (or the
//! signal-specific `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`) is set; the exporter
//! itself reads those plus `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME`,
//! `OTEL_METRIC_EXPORT_INTERVAL`, … — no DICE-prefixed knobs. With no endpoint
//! set, `init` installs nothing — `metrics()` then hands out instruments bound
//! to the global NO-OP meter, so every `.add()` at a call site is free.
//!
//! Metrics only: no trace/log export (the fmt tracing + `TraceLayer` stay
//! as-is), no collector config here — that lives with the deployment.

use std::sync::OnceLock;

use opentelemetry::global;
use opentelemetry::metrics::{Counter, Meter, UpDownCounter};
use opentelemetry::KeyValue;
use opentelemetry_otlp::{MetricExporter, Protocol, WithExportConfig};
use opentelemetry_sdk::metrics::SdkMeterProvider;
use opentelemetry_sdk::Resource;

use crate::room::Rooms;

/// Handle owning the (optional) meter provider — `shutdown` flushes the final
/// export on SIGTERM. `None` = telemetry disabled, everything is a no-op.
pub struct Telemetry {
    provider: Option<SdkMeterProvider>,
}

impl Telemetry {
    /// Final flush; call after the state-file flush on shutdown (game data
    /// outranks metrics).
    pub fn shutdown(&self) {
        if let Some(p) = &self.provider {
            if let Err(e) = p.shutdown() {
                tracing::warn!(error = %e, "otel metrics shutdown flush failed");
            }
        }
    }
}

/// The app's instruments, created lazily from the global meter — after `init`
/// has (maybe) installed the real provider, so they bind to it; without one
/// they bind to the no-op meter and cost nothing.
pub struct Metrics {
    pub games_created: Counter<u64>,
    pub players_joined: Counter<u64>,
    pub bots_added: Counter<u64>,
    pub rolls: Counter<u64>,
    pub mode_switches: Counter<u64>,
    pub rooms_reaped: Counter<u64>,
    pub ws_connections: UpDownCounter<i64>,
}

static METRICS: OnceLock<Metrics> = OnceLock::new();

pub fn metrics() -> &'static Metrics {
    METRICS.get_or_init(|| {
        let m: Meter = global::meter("dice");
        Metrics {
            games_created: m.u64_counter("dice.games.created").build(),
            players_joined: m.u64_counter("dice.players.joined").build(),
            bots_added: m.u64_counter("dice.bots.added").build(),
            rolls: m.u64_counter("dice.rolls").build(),
            mode_switches: m.u64_counter("dice.mode.switches").build(),
            rooms_reaped: m.u64_counter("dice.rooms.reaped").build(),
            ws_connections: m.i64_up_down_counter("dice.ws.connections").build(),
        }
    })
}

/// One low-cardinality attribute (mode ∈ 4 values, skill ∈ 3).
pub fn attr(key: &'static str, value: &'static str) -> [KeyValue; 1] {
    [KeyValue::new(key, value)]
}

/// Install the OTLP metrics pipeline if a standard OTel endpoint is set; else
/// no-op. MUST run before any `metrics()` call (instruments bind to whatever
/// meter provider is global at creation) — `run_server` calls it right after
/// the config loads, before the router/reaper start.
pub fn init(rooms: &Rooms) -> Telemetry {
    let endpoint_set = [
        "OTEL_EXPORTER_OTLP_ENDPOINT",
        "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
    ]
    .iter()
    .any(|k| {
        std::env::var(k)
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
    });
    if !endpoint_set {
        return Telemetry { provider: None }; // disabled — the zero-cost path
    }

    // Endpoint/headers/timeouts all come from the standard env vars, read by
    // the exporter builder itself.
    let exporter = match MetricExporter::builder()
        .with_http()
        .with_protocol(Protocol::HttpBinary)
        .build()
    {
        Ok(e) => e,
        Err(e) => {
            tracing::warn!(error = %e, "otel metrics exporter init failed — telemetry disabled");
            return Telemetry { provider: None };
        }
    };

    // Resource: honor OTEL_SERVICE_NAME when set (the builder's env detectors
    // pick it up); fall back to "dice" otherwise.
    let mut rb = Resource::builder();
    if std::env::var("OTEL_SERVICE_NAME").is_err() {
        rb = rb.with_service_name("dice");
    }
    let resource = rb
        .with_attribute(KeyValue::new("service.version", env!("CARGO_PKG_VERSION")))
        .build();

    let provider = SdkMeterProvider::builder()
        .with_periodic_exporter(exporter)
        .with_resource(resource)
        .build();

    global::set_meter_provider(provider.clone());

    // Live-rooms gauge: registered AFTER the provider install (else it would
    // bind to the no-op meter). Observed on the reader thread via a brief sync
    // lock — no await while holding it, so the lock invariant holds.
    let rooms = rooms.clone();
    global::meter("dice")
        .u64_observable_gauge("dice.rooms.active")
        .with_callback(move |obs| {
            let n = rooms.lock().map(|m| m.len() as u64).unwrap_or(0);
            obs.observe(n, &[]);
        })
        .build();

    tracing::info!("otel metrics export enabled");
    Telemetry {
        provider: Some(provider),
    }
}
