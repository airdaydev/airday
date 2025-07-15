#!/bin/bash
# In memory jaeger/oltp for testing

WORK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

docker run --rm --name jaeger \
  -p 16686:16686 \
  -p 4317:4317 \
  -p 4318:4318 \
  -p 5778:5778 \
  -p 9411:9411 \
  -v $WORK_DIR/jaeger-config.yaml:/jaeger/config.yaml \
  jaegertracing/jaeger:2.8.0 \
  --config /jaeger/config.yaml
