//! Opt-in OpenTelemetry export — METRICS (usage counters: games, joins, rolls,
//! live rooms/sockets) and LOGS (`warn!`/`error!` lines, notably the browser
//! error reports from `routes::client_error`) — configured ENTIRELY by the
//! standard `OTEL_*` env vars: export is active only when
//! `OTEL_EXPORTER_OTLP_ENDPOINT` (or a signal-specific
//! `OTEL_EXPORTER_OTLP_{METRICS,LOGS}_ENDPOINT`) is set; the exporters read
//! those plus `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME`,
//! `OTEL_METRIC_EXPORT_INTERVAL`, … — no DICE-prefixed knobs. With no endpoint
//! set, nothing is installed: `metrics()` hands out instruments bound to the
//! global NO-OP meter (every `.add()` is free) and no log layer is added.
//!
//! No TRACES: per-request spans are noise for an app whose interesting unit is a
//! game, and the `TraceLayer` fmt logging stays as-is.
//!
//! Log export exists because a metric can only say *how often* something broke.
//! Diagnosing "the invite link didn't work on my Android phone" needs the
//! message and the User-Agent, which is what a log record carries.

use std::sync::OnceLock;

use opentelemetry::global;
use opentelemetry::metrics::{Counter, Meter, UpDownCounter};
use opentelemetry::KeyValue;
use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
use opentelemetry_otlp::{LogExporter, MetricExporter, Protocol, WithExportConfig};
use opentelemetry_sdk::logs::SdkLoggerProvider;
use opentelemetry_sdk::metrics::SdkMeterProvider;
use opentelemetry_sdk::Resource;

use crate::room::Rooms;

/// Handle owning the (optional) providers — `shutdown` flushes the final export
/// on SIGTERM. `None` = telemetry disabled, everything is a no-op.
pub struct Telemetry {
    provider: Option<SdkMeterProvider>,
    logger: Option<SdkLoggerProvider>,
}

impl Telemetry {
    /// Final flush; call after the state-file flush on shutdown (game data
    /// outranks telemetry).
    pub fn shutdown(&self) {
        if let Some(p) = &self.provider {
            if let Err(e) = p.shutdown() {
                tracing::warn!(error = %e, "otel metrics shutdown flush failed");
            }
        }
        if let Some(l) = &self.logger {
            if let Err(e) = l.shutdown() {
                tracing::warn!(error = %e, "otel logs shutdown flush failed");
            }
        }
    }
}

/// True when an OTLP endpoint is configured for `signal` (or globally). Export is
/// entirely opt-in: no endpoint, no pipeline, no cost.
fn endpoint_set(signal: &str) -> bool {
    ["OTEL_EXPORTER_OTLP_ENDPOINT", signal].iter().any(|k| {
        std::env::var(k)
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
    })
}

/// Resource identity shared by both pipelines: honour `OTEL_SERVICE_NAME` when
/// set (the builder's env detectors pick it up), else fall back to "dice".
fn resource() -> Resource {
    let mut rb = Resource::builder();
    if std::env::var("OTEL_SERVICE_NAME").is_err() {
        rb = rb.with_service_name("dice");
    }
    rb.with_attribute(KeyValue::new("service.version", env!("CARGO_PKG_VERSION")))
        .build()
}

/// Build the OTLP *logs* provider, if enabled. Must run BEFORE the tracing
/// subscriber is built — the bridge is a subscriber layer, and a subscriber can't
/// be extended once installed (see `run_server`).
pub fn init_logs() -> Option<SdkLoggerProvider> {
    if !endpoint_set("OTEL_EXPORTER_OTLP_LOGS_ENDPOINT") {
        return None;
    }
    let exporter = match LogExporter::builder()
        .with_http()
        .with_protocol(Protocol::HttpBinary)
        .build()
    {
        Ok(e) => e,
        Err(e) => {
            // Can't `tracing::warn!` yet — the subscriber isn't installed.
            eprintln!("otel logs exporter init failed — log export disabled: {e}");
            return None;
        }
    };
    Some(
        SdkLoggerProvider::builder()
            .with_batch_exporter(exporter)
            .with_resource(resource())
            .build(),
    )
}

/// The tracing layer that forwards events to `provider` as OTLP log records.
pub fn logs_layer(
    provider: &SdkLoggerProvider,
) -> OpenTelemetryTracingBridge<SdkLoggerProvider, opentelemetry_sdk::logs::SdkLogger> {
    OpenTelemetryTracingBridge::new(provider)
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
    /// Browser-side failures reported to `POST /api/client-error`, by `kind`.
    /// The counter answers "how often"; the exported log record says what.
    pub client_errors: Counter<u64>,
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
            client_errors: m.u64_counter("dice.client.errors").build(),
        }
    })
}

/// One low-cardinality attribute (mode ∈ 4 values, skill ∈ 3, kind ∈ 9).
pub fn attr(key: &'static str, value: &'static str) -> [KeyValue; 1] {
    [KeyValue::new(key, value)]
}

/// Install the OTLP metrics pipeline if a standard OTel endpoint is set; else
/// no-op. MUST run before any `metrics()` call (instruments bind to whatever
/// meter provider is global at creation) — `run_server` calls it right after
/// the config loads, before the router/reaper start. `logger` is the (already
/// built) logs provider from `init_logs`, adopted here so one handle flushes both.
pub fn init(rooms: &Rooms, logger: Option<SdkLoggerProvider>) -> Telemetry {
    if !endpoint_set("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT") {
        // Metrics disabled — the zero-cost path. Logs are independent.
        return Telemetry {
            provider: None,
            logger,
        };
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
            tracing::warn!(error = %e, "otel metrics exporter init failed — metrics disabled");
            return Telemetry {
                provider: None,
                logger,
            };
        }
    };

    let provider = SdkMeterProvider::builder()
        .with_periodic_exporter(exporter)
        .with_resource(resource())
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
        logger,
    }
}
