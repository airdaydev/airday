use crate::common::config::AirdayConfig;
use opentelemetry::trace::TracerProvider;
use opentelemetry::{KeyValue, global};
use opentelemetry_otlp::{SpanExporterBuilder, WithExportConfig};
use opentelemetry_sdk::Resource;
use opentelemetry_sdk::trace::SdkTracerProvider;
use tracing::info;
use tracing::level_filters::LevelFilter;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

// TODO: opentelemetry_otlp crate v0.30.0 has no logs compatibility (traces/metrics only)
// TODO: in production we could patch this by also reading logs directly (... for another time)
pub fn setup(cfg: &AirdayConfig) {
    let mut level_filter = LevelFilter::INFO;
    if cfg.log_level == "debug" {
        level_filter = LevelFilter::DEBUG;
    }
    let registry = tracing_subscriber::registry()
        .with(level_filter)
        .with(tracing_subscriber::fmt::layer());

    if let Some(otlp_host) = cfg.otlp_host.as_deref() {
        let span_exporter = SpanExporterBuilder::new()
            .with_http()
            .with_endpoint(otlp_host)
            .with_protocol(opentelemetry_otlp::Protocol::HttpBinary)
            .build()
            .unwrap();

        let resource = Resource::builder()
            .with_service_name("airday")
            .with_attribute(KeyValue::new("service.name", "airday_server"))
            .with_attribute(KeyValue::new("service.version", env!("CARGO_PKG_VERSION")))
            .build();
        // TODO: Instance id!

        let trace_provider = SdkTracerProvider::builder()
            .with_batch_exporter(span_exporter)
            .with_resource(resource.clone())
            .build();

        let tracer = trace_provider.tracer("airday");
        global::set_tracer_provider(trace_provider);

        let telemetry_layer = tracing_opentelemetry::layer().with_tracer(tracer);
        registry.with(telemetry_layer).init();
    } else {
        registry.init();
    }
    info!(level_filter = level_filter.to_string(), "Tracer started");
}
