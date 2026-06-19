# Runtime image for airday-server.
#
# There is no build stage: the binary is produced in the release workflow (with
# the web client embedded via the `bundled-web` feature) and copied in here.
# debian:bookworm-slim supplies the glibc the gnu-target binary links against;
# the server needs nothing else — sqlite is compiled into the binary and it
# makes no outbound network calls.
FROM debian:bookworm-slim

# Staged next to this Dockerfile by the release workflow's build context.
COPY airday-server /usr/local/bin/airday-server

# Container defaults; override per `docker run -e`. Bind MUST be 0.0.0.0 to be
# reachable from outside the container (the app default is 127.0.0.1). The
# sqlite db lives on the /data volume so it survives container replacement.
ENV AIRDAY_BIND=0.0.0.0:8000 \
    AIRDAY_DB_PATH=/data/airday.sqlite

EXPOSE 8000
VOLUME ["/data"]

ENTRYPOINT ["/usr/local/bin/airday-server"]
