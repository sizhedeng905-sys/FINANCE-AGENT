# syntax=docker/dockerfile:1.21@sha256:27f9262d43452075f3c410287a2c43f5ef1bf7ec2bb06e8c9eeb1b8d453087bc

ARG GO_IMAGE=golang:1.26.5-bookworm@sha256:1ecb7edf62a0408027bd5729dfd6b1b8766e578e8df93995b225dfd0944eb651
ARG DEBIAN_IMAGE=debian:bookworm-slim@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818
ARG ALLOY_SOURCE_COMMIT=89d82370454dcee7b07d719ba632810e207a6de9
ARG ALLOY_SOURCE_SHA256=4f7ab8f4fd7b6142a0aff49abc3988f21a5153c617dc447aa3d65739d07c383c
ARG ALLOY_VERSION=v1.16.1-finance-agent.1
ARG BUILD_GIT_SHA=unverified

FROM ${GO_IMAGE} AS alloy-builder
ARG ALLOY_SOURCE_COMMIT
ARG ALLOY_SOURCE_SHA256
ARG ALLOY_VERSION
WORKDIR /src/alloy
RUN curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 \
      --output /tmp/alloy.tar.gz "https://github.com/grafana/alloy/archive/${ALLOY_SOURCE_COMMIT}.tar.gz" \
    && echo "${ALLOY_SOURCE_SHA256}  /tmp/alloy.tar.gz" | sha256sum --check --strict \
    && tar --extract --gzip --file /tmp/alloy.tar.gz --strip-components=1 \
    && rm /tmp/alloy.tar.gz
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    cd collector \
    && GOTOOLCHAIN=local go get \
      golang.org/x/crypto@v0.52.0 \
      golang.org/x/net@v0.55.0 \
    && CGO_ENABLED=1 GOTOOLCHAIN=local go build -mod=mod -buildvcs=false -trimpath \
      -tags="gore2regex netgo" \
      -ldflags="-s -w \
        -X github.com/grafana/alloy/internal/build.Branch=v1.16.1 \
        -X github.com/grafana/alloy/internal/build.Version=${ALLOY_VERSION} \
        -X github.com/grafana/alloy/internal/build.Revision=${ALLOY_SOURCE_COMMIT} \
        -X github.com/grafana/alloy/syntax/internal/stdlib.Version=${ALLOY_VERSION}" \
      -o /out/alloy .

FROM ${DEBIAN_IMAGE}
ARG ALLOY_SOURCE_COMMIT
ARG ALLOY_SOURCE_SHA256
ARG ALLOY_VERSION
ARG BUILD_GIT_SHA
LABEL org.opencontainers.image.source="https://github.com/grafana/alloy" \
      org.opencontainers.image.revision=${BUILD_GIT_SHA} \
      io.finance-agent.alloy.source-revision=${ALLOY_SOURCE_COMMIT} \
      io.finance-agent.alloy.source-sha256=${ALLOY_SOURCE_SHA256} \
      io.finance-agent.alloy.version=${ALLOY_VERSION}
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/lib/alloy/data
COPY --from=alloy-builder /out/alloy /usr/local/bin/alloy
ENTRYPOINT ["/usr/local/bin/alloy"]
CMD ["run", "/etc/alloy/config.alloy", "--storage.path=/var/lib/alloy/data"]
