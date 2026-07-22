# syntax=docker/dockerfile:1.21@sha256:27f9262d43452075f3c410287a2c43f5ef1bf7ec2bb06e8c9eeb1b8d453087bc

ARG GO_IMAGE=golang:1.26.5-bookworm@sha256:1ecb7edf62a0408027bd5729dfd6b1b8766e578e8df93995b225dfd0944eb651
ARG DEBIAN_IMAGE=debian:bookworm-slim@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818
ARG TEMPO_SOURCE_COMMIT=991ce39eb956e9ed771fcffe05eff42d33de27ba
ARG TEMPO_SOURCE_SHA256=d8d1c1c7949343263621fa5d6b98030486841d1fb64622bbbbcb7ac21b593540
ARG TEMPO_VERSION=v2.10.5-finance-agent.1
ARG BUILD_GIT_SHA=unverified

FROM ${GO_IMAGE} AS tempo-builder
ARG TEMPO_SOURCE_COMMIT
ARG TEMPO_SOURCE_SHA256
ARG TEMPO_VERSION
WORKDIR /src/tempo
RUN curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 \
      --output /tmp/tempo.tar.gz "https://github.com/grafana/tempo/archive/${TEMPO_SOURCE_COMMIT}.tar.gz" \
    && echo "${TEMPO_SOURCE_SHA256}  /tmp/tempo.tar.gz" | sha256sum --check --strict \
    && tar --extract --gzip --file /tmp/tempo.tar.gz --strip-components=1 \
    && rm /tmp/tempo.tar.gz
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    GOTOOLCHAIN=local go get \
      golang.org/x/crypto@v0.52.0 \
      golang.org/x/net@v0.55.0 \
      google.golang.org/grpc@v1.79.3 \
    && CGO_ENABLED=0 GOTOOLCHAIN=local go build -mod=mod -buildvcs=false -trimpath \
      -tags="netgo osusergo" \
      -ldflags="-s -w \
        -X main.Version=${TEMPO_VERSION} \
        -X main.Revision=${TEMPO_SOURCE_COMMIT} \
        -X main.Branch=finance-agent-security-build" \
      -o /out/tempo ./cmd/tempo

FROM ${DEBIAN_IMAGE}
ARG TEMPO_SOURCE_COMMIT
ARG TEMPO_SOURCE_SHA256
ARG TEMPO_VERSION
ARG BUILD_GIT_SHA
LABEL org.opencontainers.image.source="https://github.com/grafana/tempo" \
      org.opencontainers.image.revision=${BUILD_GIT_SHA} \
      io.finance-agent.tempo.source-revision=${TEMPO_SOURCE_COMMIT} \
      io.finance-agent.tempo.source-sha256=${TEMPO_SOURCE_SHA256} \
      io.finance-agent.tempo.version=${TEMPO_VERSION}
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 tempo \
    && useradd --system --uid 10001 --gid tempo --home-dir /var/tempo --shell /usr/sbin/nologin tempo \
    && install -d -o tempo -g tempo -m 0750 /var/tempo
COPY --from=tempo-builder /out/tempo /usr/local/bin/tempo
USER 10001:10001
EXPOSE 3200 4317 4318 9095
ENTRYPOINT ["/usr/local/bin/tempo"]
CMD ["-config.file=/etc/tempo/tempo.yml"]
