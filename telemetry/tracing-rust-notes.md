# Tracing in rust

## In a nutshell
A trace represent an abstraction of work, that may or may not flow through a distributed system. Spans are a more discrete unit of work contained within that trace. Traces are defined by a trace_id attribute on the span object, though trace_ids may be sent across the wire to provide context for new spans.

Spans have beginnings and ends thus represent a span of time. Spans can have child spans & sibling spans. Individual instantaneous events can be recorded on spans.
```
[span][spaaaaaaan][spaaan]
                  [span]
```

OpenTelemetry is the standard that came out of various competing systems. OpenTelemetry Protocol (OTLP) is a protocol used for sending traces, logs and telemetry.

## OTLP
- Format definition: https://github.com/open-telemetry/opentelemetry-specification/blob/main/oteps/trace/0059-otlp-trace-data-format.md
- JSON definition: https://github.com/open-telemetry/opentelemetry-proto/blob/main/examples/trace.json


## Rust tracing package
https://docs.rs/tracing/latest/tracing/

tracing is the primary package. Subscribers are implementations of the Subscriber trait and are notified on span enter, exit and event. Subscribers can implement the `enabled` function to filter notifications based on metadata of events and spans.

## Opentelemetry package
https://docs.rs/tracing-opentelemetry/0.22.0/tracing_opentelemetry/

A subscriber to bip these off to an otlp endpoint. Note opentelemetry & opentelemetry_sdk are included in this package.
