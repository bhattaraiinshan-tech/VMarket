FROM golang:1.26-bookworm AS builder

WORKDIR /src
RUN git clone --depth 1 --branch RELEASE.2025-09-07T16-13-09Z https://github.com/minio/minio.git . \
    && test "$(git rev-parse HEAD)" = "07c3a429bfed433e49018cb0f78a52145d4bedeb"
RUN CGO_ENABLED=0 go build -trimpath -o /out/minio .

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir /data \
    && chown 10001:10001 /data
COPY --from=builder /out/minio /usr/local/bin/minio
COPY --from=builder /src/LICENSE /usr/share/doc/minio/LICENSE
USER 10001:10001
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
CMD ["server", "/data", "--console-address", ":9001"]
