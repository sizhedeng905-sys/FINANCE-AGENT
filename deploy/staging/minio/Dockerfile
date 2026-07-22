# syntax=docker/dockerfile:1.21@sha256:27f9262d43452075f3c410287a2c43f5ef1bf7ec2bb06e8c9eeb1b8d453087bc

ARG GO_IMAGE=golang:1.26.5-bookworm@sha256:1ecb7edf62a0408027bd5729dfd6b1b8766e578e8df93995b225dfd0944eb651
ARG DEBIAN_IMAGE=debian:bookworm-slim@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818
ARG MINIO_SOURCE_COMMIT=7aac2a2c5b7c882e68c1ce017d8256be2feea27f
ARG MINIO_SOURCE_SHA256=71794c2df26aad0cc99e8421c58b7aa2dd55969f979b0e7d1e931042e9fabcd6
ARG MINIO_VERSION=SOURCE.2026-04-finance-agent.1
ARG MINIO_SHORT_COMMIT=7aac2a2c5b7c
ARG BUILD_GIT_SHA=unverified

FROM ${GO_IMAGE} AS minio-builder
ARG MINIO_SOURCE_COMMIT
ARG MINIO_SOURCE_SHA256
ARG MINIO_VERSION
ARG MINIO_SHORT_COMMIT
WORKDIR /src/minio
RUN curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 \
      --output /tmp/minio.tar.gz "https://github.com/minio/minio/archive/${MINIO_SOURCE_COMMIT}.tar.gz" \
    && echo "${MINIO_SOURCE_SHA256}  /tmp/minio.tar.gz" | sha256sum --check --strict \
    && tar --extract --gzip --file /tmp/minio.tar.gz --strip-components=1 \
    && rm /tmp/minio.tar.gz
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    GOTOOLCHAIN=local go get \
      golang.org/x/crypto@v0.52.0 \
      golang.org/x/net@v0.55.0 \
      google.golang.org/grpc@v1.79.3 \
    && CGO_ENABLED=0 GOTOOLCHAIN=local go build -mod=mod -buildvcs=false -trimpath \
      -tags="kqueue netgo osusergo" \
      -ldflags="-s -w \
        -X github.com/minio/minio/cmd.Version=${MINIO_VERSION} \
        -X github.com/minio/minio/cmd.CopyrightYear=2026 \
        -X github.com/minio/minio/cmd.ReleaseTag=${MINIO_VERSION} \
        -X github.com/minio/minio/cmd.CommitID=${MINIO_SOURCE_COMMIT} \
        -X github.com/minio/minio/cmd.ShortCommitID=${MINIO_SHORT_COMMIT}" \
      -o /out/minio .

FROM ${DEBIAN_IMAGE}
ARG MINIO_SOURCE_COMMIT
ARG MINIO_SOURCE_SHA256
ARG MINIO_VERSION
ARG BUILD_GIT_SHA
LABEL org.opencontainers.image.source="https://github.com/minio/minio" \
      org.opencontainers.image.revision=${BUILD_GIT_SHA} \
      io.finance-agent.minio.source-revision=${MINIO_SOURCE_COMMIT} \
      io.finance-agent.minio.source-sha256=${MINIO_SOURCE_SHA256} \
      io.finance-agent.minio.version=${MINIO_VERSION} \
      io.finance-agent.minio.production-approval="pending-h13"
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 minio \
    && useradd --system --uid 10001 --gid minio --home-dir /data --shell /usr/sbin/nologin minio \
    && install -d -o minio -g minio -m 0750 /data
COPY --from=minio-builder /out/minio /usr/local/bin/minio
COPY --chmod=0555 minio-entrypoint.sh /usr/local/bin/minio-entrypoint
USER 10001:10001
EXPOSE 9000 9001
ENTRYPOINT ["/usr/local/bin/minio-entrypoint"]
CMD ["server", "/data", "--console-address", ":9001"]
