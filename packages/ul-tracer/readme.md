# @airday/ul-tracer

This is a fairly vibecoded (to be reviewed) tracer designed to get logs from Airday's web front-end to back-end. The aim is to send Open Telemetry Protocol (OTLP) compatible ExportTraceServiceRequests as gzipped Protobuf JSON (i.e. a subset of JSON conforming to Protobuf's JSON output), flushed every x seconds, with 3x incrementally backed-off retries. I care about bundle-size for the web app and control the logging infra so yeah.

## TODO:
- [] Check the vibes
- [] https://www.jaegertracing.io/docs/1.22/getting-started/ Test with jaeger initially and write test suite for integration testing
- [] Bring up Signoz and same thing

## OpenTelemetry collector testing
```bash
docker pull otel/opentelemetry-collector-contrib:0.128.0
# Not exposing zpages, grpc, only OTLP HTTP
docker run \
  -p 127.0.0.1:4318:4318 \
  otel/opentelemetry-collector-contrib:0.128.0
# ./jaeger.sh
# firefox http://localhost:16686/search
```
