use crate::common::config::AirdayConfig;
use opentelemetry::trace::TracerProvider;
use opentelemetry::{KeyValue, global};
use opentelemetry_otlp::{SpanExporter, WithExportConfig};
use opentelemetry_sdk::Resource;
use opentelemetry_sdk::trace::SdkTracerProvider;
use tracing::level_filters::LevelFilter;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

pub fn setup(cfg: &AirdayConfig) {
    let mut level_filter = LevelFilter::INFO;
    if cfg.log_level == "debug" {
        level_filter = LevelFilter::DEBUG;
    }
    let registry = tracing_subscriber::registry()
        .with(level_filter)
        .with(tracing_subscriber::fmt::layer());

    if let Some(otlp_host) = cfg.otlp_host.as_deref() {
        let exporter = SpanExporter::builder()
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

        let provider = SdkTracerProvider::builder()
            .with_batch_exporter(exporter)
            .with_resource(resource)
            .build();

        let tracer = provider.tracer("airday");
        global::set_tracer_provider(provider);

        let telemetry_layer = tracing_opentelemetry::layer().with_tracer(tracer);
        registry
            .with(level_filter)
            .with(tracing_subscriber::fmt::layer())
            .with(telemetry_layer)
            .init();
    } else {
        registry.init();
    }
}
