# @airday/tracer

This is a (initially vibecoded) tracer designed to get logs from Airday's web front-end to back-end. The aim is to send Open Telemetry Protocol (OTLP) compatible ExportTraceServiceRequests as gzipped Protobuf JSON (i.e. a subset of JSON conforming to Protobuf's JSON output), flushed every x seconds, with 3x incrementally backed-off retries. I care about bundle-size for the web app and control the logging infra so yeah.
