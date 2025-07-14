# @airday/tracer

This is a (initially vibecoded) tracer designed to get logs from Airday's web front-end to back-end. The aim is to send Open Telemetry Protocol (OTLP) compatible ExportTraceServiceRequests as gzipped Protobuf JSON (i.e. a subset of JSON conforming to Protobuf's JSON output), flushed every x seconds, with 3x incrementally backed-off retries. I care about bundle-size for the web app and control the logging infra so yeah.

## OpenTelemetry collector testing
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
