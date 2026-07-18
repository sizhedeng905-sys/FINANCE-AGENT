# syntax=docker/dockerfile:1.21@sha256:27f9262d43452075f3c410287a2c43f5ef1bf7ec2bb06e8c9eeb1b8d453087bc

ARG GO_IMAGE=golang:1.26.5-bookworm@sha256:1ecb7edf62a0408027bd5729dfd6b1b8766e578e8df93995b225dfd0944eb651
ARG NODE_IMAGE=node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d
ARG DEBIAN_IMAGE=debian:bookworm-slim@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818
ARG PROMETHEUS_SOURCE_COMMIT=9f27dffc1f93ca23287972f632025879f2d1c658
ARG PROMETHEUS_SOURCE_SHA256=c283ca395b8ab9fe5f680c2ff75f20d801a40af59dbb9b453311ee858a2c42db
ARG PROMETHEUS_VERSION=3.12.0-finance-agent.1
ARG BUILD_GIT_SHA=unverified

FROM ${GO_IMAGE} AS prometheus-source
ARG PROMETHEUS_SOURCE_COMMIT
ARG PROMETHEUS_SOURCE_SHA256
WORKDIR /src/prometheus
RUN curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 \
      --output /tmp/prometheus.tar.gz "https://github.com/prometheus/prometheus/archive/${PROMETHEUS_SOURCE_COMMIT}.tar.gz" \
    && echo "${PROMETHEUS_SOURCE_SHA256}  /tmp/prometheus.tar.gz" | sha256sum --check --strict \
    && tar --extract --gzip --file /tmp/prometheus.tar.gz --strip-components=1 \
    && rm /tmp/prometheus.tar.gz

FROM ${NODE_IMAGE} AS prometheus-ui
COPY --from=prometheus-source /src/prometheus /src/prometheus
WORKDIR /src/prometheus/web/ui
RUN npm ci \
    && cd react-app \
    && npm ci \
    && cd .. \
    && CI='' npm run build \
    && test -s static/mantine-ui/index.html \
    && test -s static/react-app/index.html

FROM ${GO_IMAGE} AS prometheus-builder
ARG PROMETHEUS_SOURCE_COMMIT
ARG PROMETHEUS_VERSION
COPY --from=prometheus-source /src/prometheus /src/prometheus
COPY --from=prometheus-ui /src/prometheus/web/ui/static /src/prometheus/web/ui/static
WORKDIR /src/prometheus
RUN scripts/compress_assets.sh
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    GOTOOLCHAIN=local go get \
      golang.org/x/crypto@v0.52.0 \
      golang.org/x/net@v0.55.0 \
    && for target in prometheus promtool; do \
      CGO_ENABLED=0 GOTOOLCHAIN=local go build -buildvcs=false -trimpath \
        -tags="netgo osusergo builtinassets" \
        -ldflags="-s -w \
          -X github.com/prometheus/common/version.Version=${PROMETHEUS_VERSION} \
          -X github.com/prometheus/common/version.Revision=${PROMETHEUS_SOURCE_COMMIT} \
          -X github.com/prometheus/common/version.Branch=finance-agent-security-build \
          -X github.com/prometheus/common/version.BuildUser=finance-agent" \
        -o "/out/${target}" "./cmd/${target}"; \
    done

FROM ${DEBIAN_IMAGE}
ARG PROMETHEUS_SOURCE_COMMIT
ARG PROMETHEUS_SOURCE_SHA256
ARG PROMETHEUS_VERSION
ARG BUILD_GIT_SHA
LABEL org.opencontainers.image.source="https://github.com/prometheus/prometheus" \
      org.opencontainers.image.revision=${BUILD_GIT_SHA} \
      io.finance-agent.prometheus.source-revision=${PROMETHEUS_SOURCE_COMMIT} \
      io.finance-agent.prometheus.source-sha256=${PROMETHEUS_SOURCE_SHA256} \
      io.finance-agent.prometheus.version=${PROMETHEUS_VERSION}
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 prometheus \
    && useradd --system --uid 10001 --gid prometheus --home-dir /prometheus --shell /usr/sbin/nologin prometheus \
    && install -d -o prometheus -g prometheus -m 0750 /prometheus
COPY --from=prometheus-builder /out/prometheus /usr/local/bin/prometheus
COPY --from=prometheus-builder /out/promtool /usr/local/bin/promtool
USER 10001:10001
EXPOSE 9090
ENTRYPOINT ["/usr/local/bin/prometheus"]
CMD ["--config.file=/etc/prometheus/prometheus.yml", "--storage.tsdb.path=/prometheus"]
