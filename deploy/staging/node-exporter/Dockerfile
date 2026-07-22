# syntax=docker/dockerfile:1.21@sha256:27f9262d43452075f3c410287a2c43f5ef1bf7ec2bb06e8c9eeb1b8d453087bc

ARG GO_IMAGE=golang:1.26.5-bookworm@sha256:1ecb7edf62a0408027bd5729dfd6b1b8766e578e8df93995b225dfd0944eb651
ARG DEBIAN_IMAGE=debian:bookworm-slim@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818
ARG NODE_EXPORTER_SOURCE_COMMIT=0dd664dece3f8319f6bec5a221acd2c7ad13a23d
ARG NODE_EXPORTER_SOURCE_SHA256=8da6b3d3f4fc8411dabe65cb9a619cf0a17c5088dbc825bd127d314994cc41f9
ARG NODE_EXPORTER_VERSION=1.11.1-finance-agent.1
ARG BUILD_GIT_SHA=unverified

FROM ${GO_IMAGE} AS node-exporter-builder
ARG NODE_EXPORTER_SOURCE_COMMIT
ARG NODE_EXPORTER_SOURCE_SHA256
ARG NODE_EXPORTER_VERSION
WORKDIR /src/node-exporter
RUN curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 \
      --output /tmp/node-exporter.tar.gz "https://github.com/prometheus/node_exporter/archive/${NODE_EXPORTER_SOURCE_COMMIT}.tar.gz" \
    && echo "${NODE_EXPORTER_SOURCE_SHA256}  /tmp/node-exporter.tar.gz" | sha256sum --check --strict \
    && tar --extract --gzip --file /tmp/node-exporter.tar.gz --strip-components=1 \
    && rm /tmp/node-exporter.tar.gz
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    GOTOOLCHAIN=local go get \
      golang.org/x/crypto@v0.52.0 \
      golang.org/x/net@v0.55.0 \
    && CGO_ENABLED=0 GOTOOLCHAIN=local go build -mod=mod -buildvcs=false -trimpath \
      -tags="netgo osusergo" \
      -ldflags="-s -w \
        -X github.com/prometheus/common/version.Version=${NODE_EXPORTER_VERSION} \
        -X github.com/prometheus/common/version.Revision=${NODE_EXPORTER_SOURCE_COMMIT} \
        -X github.com/prometheus/common/version.Branch=finance-agent-security-build \
        -X github.com/prometheus/common/version.BuildUser=finance-agent" \
      -o /out/node_exporter .

FROM ${DEBIAN_IMAGE}
ARG NODE_EXPORTER_SOURCE_COMMIT
ARG NODE_EXPORTER_SOURCE_SHA256
ARG NODE_EXPORTER_VERSION
ARG BUILD_GIT_SHA
LABEL org.opencontainers.image.source="https://github.com/prometheus/node_exporter" \
      org.opencontainers.image.revision=${BUILD_GIT_SHA} \
      io.finance-agent.node-exporter.source-revision=${NODE_EXPORTER_SOURCE_COMMIT} \
      io.finance-agent.node-exporter.source-sha256=${NODE_EXPORTER_SOURCE_SHA256} \
      io.finance-agent.node-exporter.version=${NODE_EXPORTER_VERSION}
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node-exporter-builder /out/node_exporter /usr/local/bin/node_exporter
USER 65534:65534
EXPOSE 9100
ENTRYPOINT ["/usr/local/bin/node_exporter"]
