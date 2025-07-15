# Telemetry
Development tracing ingestion etc

## Standalone OpenTelemetry collector testing
Ultra-light weight testing
```bash
docker pull otel/opentelemetry-collector-contrib:0.128.0
# Not exposing zpages, grpc, only OTLP HTTP
docker run \
  -p 127.0.0.1:4318:4318 \
  -v ./otel-collector-config.yaml:/etc/otel-collector-config.yaml \
  otel/opentelemetry-collector-contrib:0.128.0 \
  --config=/etc/otel-collector-config.yaml
```

## Jaeger testing
N.b. Jaeger incl. OpenTelemetry Collector. Default port for OTLP Protobuf/JSON is 4318 @ /v1/traces. An explicit yaml file can be provided.
```bash
./jaeger.sh
firefox http://localhost:16686/search
```
