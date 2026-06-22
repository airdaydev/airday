# Runtime image for airday-server.
#
# There is no build stage: the binary is produced in the release workflow (with
# the web client embedded via the `bundled-web` feature) and copied in here.
# distroless/cc-debian12 is Debian 12 glibc plus libgcc_s — the latter is needed
# because the gnu-target binary is built with panic=unwind and links it for
# stack unwinding. The server needs nothing else: sqlite is compiled into the
# binary and it makes no outbound network calls (so no ca-certificates either).
#
# The `:debug` tag is identical to the hardened base but bundles busybox at
# /busybox, so `docker exec -it <c> /busybox/sh` still works for diagnosing
# mount/config issues in a running container. Runs as root, matching the prior
# bookworm-slim behaviour so the /data volume stays writable without a chown.
FROM gcr.io/distroless/cc-debian12:debug

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
