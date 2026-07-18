# syntax=docker/dockerfile:1.21@sha256:27f9262d43452075f3c410287a2c43f5ef1bf7ec2bb06e8c9eeb1b8d453087bc

ARG GO_IMAGE=golang:1.26.5-bookworm@sha256:1ecb7edf62a0408027bd5729dfd6b1b8766e578e8df93995b225dfd0944eb651
ARG DEBIAN_IMAGE=debian:bookworm-slim@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818
ARG ALERTMANAGER_SOURCE_COMMIT=8768aa6f65f1a888b5aa5fbf877cf20ad45d1f61
ARG ALERTMANAGER_SOURCE_SHA256=ebbbe5480c177c6cd0f3a82eabda70d182e06fc31fb6bc1a1b8be177951b561c
ARG ALERTMANAGER_UI_SHA256=fca5b665281e603c055d812ac0359b027772c5e30c9a8cd0ca1367aac698cfa6
ARG ALERTMANAGER_VERSION=0.32.1-finance-agent.1
ARG BUILD_GIT_SHA=unverified

FROM ${GO_IMAGE} AS alertmanager-source
ARG ALERTMANAGER_SOURCE_COMMIT
ARG ALERTMANAGER_SOURCE_SHA256
WORKDIR /src/alertmanager
RUN curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 \
      --output /tmp/alertmanager.tar.gz "https://github.com/prometheus/alertmanager/archive/${ALERTMANAGER_SOURCE_COMMIT}.tar.gz" \
    && echo "${ALERTMANAGER_SOURCE_SHA256}  /tmp/alertmanager.tar.gz" | sha256sum --check --strict \
    && tar --extract --gzip --file /tmp/alertmanager.tar.gz --strip-components=1 \
    && rm /tmp/alertmanager.tar.gz

FROM ${GO_IMAGE} AS alertmanager-builder
ARG ALERTMANAGER_SOURCE_COMMIT
ARG ALERTMANAGER_UI_SHA256
ARG ALERTMANAGER_VERSION
COPY --from=alertmanager-source /src/alertmanager /src/alertmanager
ADD --checksum=sha256:${ALERTMANAGER_UI_SHA256} \
    https://github.com/prometheus/alertmanager/releases/download/v0.32.1/alertmanager-web-ui-0.32.1.tar.gz \
    /tmp/alertmanager-ui.tar.gz
WORKDIR /src/alertmanager
RUN echo "${ALERTMANAGER_UI_SHA256}  /tmp/alertmanager-ui.tar.gz" | sha256sum --check --strict \
    && mkdir -p /tmp/alertmanager-ui \
    && tar --extract --gzip --file /tmp/alertmanager-ui.tar.gz --directory /tmp/alertmanager-ui \
    && test -f /tmp/alertmanager-ui/dist/.build_stamp \
    && test -s /tmp/alertmanager-ui/dist/index.html.gz \
    && test -s /tmp/alertmanager-ui/dist/index.html.br \
    && rm -rf ui/app/dist \
    && cp -a /tmp/alertmanager-ui/dist ui/app/dist \
    && rm /tmp/alertmanager-ui.tar.gz \
    && test -f ui/app/dist/.build_stamp
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    GOTOOLCHAIN=local go get \
      golang.org/x/crypto@v0.52.0 \
      golang.org/x/net@v0.55.0 \
    && for target in alertmanager amtool; do \
      CGO_ENABLED=0 GOTOOLCHAIN=local go build -mod=mod -buildvcs=false -trimpath \
        -tags="netgo osusergo" \
        -ldflags="-s -w \
          -X github.com/prometheus/common/version.Version=${ALERTMANAGER_VERSION} \
          -X github.com/prometheus/common/version.Revision=${ALERTMANAGER_SOURCE_COMMIT} \
          -X github.com/prometheus/common/version.Branch=finance-agent-security-build \
          -X github.com/prometheus/common/version.BuildUser=finance-agent" \
        -o "/out/${target}" "./cmd/${target}"; \
    done

FROM ${DEBIAN_IMAGE}
ARG ALERTMANAGER_SOURCE_COMMIT
ARG ALERTMANAGER_SOURCE_SHA256
ARG ALERTMANAGER_VERSION
ARG BUILD_GIT_SHA
LABEL org.opencontainers.image.source="https://github.com/prometheus/alertmanager" \
      org.opencontainers.image.revision=${BUILD_GIT_SHA} \
      io.finance-agent.alertmanager.source-revision=${ALERTMANAGER_SOURCE_COMMIT} \
      io.finance-agent.alertmanager.source-sha256=${ALERTMANAGER_SOURCE_SHA256} \
      io.finance-agent.alertmanager.version=${ALERTMANAGER_VERSION}
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 alertmanager \
    && useradd --system --uid 10001 --gid alertmanager --home-dir /alertmanager --shell /usr/sbin/nologin alertmanager \
    && install -d -o alertmanager -g alertmanager -m 0750 /alertmanager
COPY --from=alertmanager-builder /out/alertmanager /usr/local/bin/alertmanager
COPY --from=alertmanager-builder /out/amtool /usr/local/bin/amtool
USER 10001:10001
EXPOSE 9093
ENTRYPOINT ["/usr/local/bin/alertmanager"]
CMD ["--config.file=/etc/alertmanager/alertmanager.yml", "--storage.path=/alertmanager"]
