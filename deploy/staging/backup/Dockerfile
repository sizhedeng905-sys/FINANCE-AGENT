ARG GO_IMAGE=golang:1.26.5-bookworm@sha256:1ecb7edf62a0408027bd5729dfd6b1b8766e578e8df93995b225dfd0944eb651
ARG DEBIAN_IMAGE=debian:bookworm-slim@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818
ARG POSTGRES_PACKAGE_VERSION=17.10-1.pgdg12+1
ARG POSTGRES_COMMON_VERSION=293.pgdg12+1
ARG LIBPQ_PACKAGE_VERSION=18.4-1.pgdg12+1
ARG BUILD_GIT_SHA=unverified
ARG MC_SOURCE_COMMIT=77f82e18b5401a65958f1619df6ebb994634bd88
ARG MC_SOURCE_SHA256=167415edd21bc29f5360943dac64272aa5cda0a39f3070b15cfeca671c43d975
ARG MC_SOURCE_VERSION=SOURCE.2025-11-06T16-25-29Z
ARG MC_SOURCE_SHORT_COMMIT=77f82e18b540
ARG POSTGRES_SIGNING_KEY_SHA256=0144068502a1eddd2a0280ede10ef607d1ec592ce819940991203941564e8e76

FROM ${GO_IMAGE} AS minio-client-builder
ARG MC_SOURCE_COMMIT
ARG MC_SOURCE_SHA256
ARG MC_SOURCE_VERSION
ARG MC_SOURCE_SHORT_COMMIT
WORKDIR /src
RUN curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 \
      --output /tmp/minio-mc.tar.gz "https://github.com/minio/mc/archive/${MC_SOURCE_COMMIT}.tar.gz" \
    && echo "${MC_SOURCE_SHA256}  /tmp/minio-mc.tar.gz" | sha256sum --check --strict \
    && tar --extract --gzip --file /tmp/minio-mc.tar.gz --strip-components=1 \
    && rm /tmp/minio-mc.tar.gz
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    GOTOOLCHAIN=local go get \
      github.com/prometheus/prometheus@v0.311.3 \
      golang.org/x/crypto@v0.52.0 \
      golang.org/x/net@v0.55.0 \
      google.golang.org/grpc@v1.79.3 \
    && CGO_ENABLED=0 GOTOOLCHAIN=local go build -mod=mod -buildvcs=false -trimpath \
      -ldflags="-s -w -X github.com/minio/mc/cmd.Version=${MC_SOURCE_VERSION} \
        -X github.com/minio/mc/cmd.CopyrightYear=2025 \
        -X github.com/minio/mc/cmd.ReleaseTag=${MC_SOURCE_VERSION} \
        -X github.com/minio/mc/cmd.CommitID=${MC_SOURCE_COMMIT} \
        -X github.com/minio/mc/cmd.ShortCommitID=${MC_SOURCE_SHORT_COMMIT}" \
      -o /out/mc .

FROM ${DEBIAN_IMAGE}
ARG BUILD_GIT_SHA
ARG POSTGRES_PACKAGE_VERSION
ARG POSTGRES_COMMON_VERSION
ARG LIBPQ_PACKAGE_VERSION
ARG MC_SOURCE_COMMIT
ARG MC_SOURCE_SHA256
ARG MC_SOURCE_VERSION
ARG POSTGRES_SIGNING_KEY_SHA256
LABEL org.opencontainers.image.revision=${BUILD_GIT_SHA} \
      io.finance-agent.postgres-client.package-version=${POSTGRES_PACKAGE_VERSION} \
      io.finance-agent.minio-mc.source-revision=${MC_SOURCE_COMMIT} \
      io.finance-agent.minio-mc.source-sha256=${MC_SOURCE_SHA256} \
      io.finance-agent.minio-mc.source-version=${MC_SOURCE_VERSION} \
      io.finance-agent.postgres.pgdg-key-sha256=${POSTGRES_SIGNING_KEY_SHA256}
ENV LANG=C.UTF-8 \
    PATH=/usr/lib/postgresql/17/bin:$PATH
ADD --checksum=sha256:${POSTGRES_SIGNING_KEY_SHA256} \
    https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    /usr/local/share/keyrings/postgres.gpg.asc
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates gpgv \
    && rm -rf /var/lib/apt/lists/*

RUN echo "${POSTGRES_SIGNING_KEY_SHA256}  /usr/local/share/keyrings/postgres.gpg.asc" | sha256sum --check --strict \
    && chmod 0644 /usr/local/share/keyrings/postgres.gpg.asc \
    && printf 'deb [signed-by=/usr/local/share/keyrings/postgres.gpg.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main\n' > /etc/apt/sources.list.d/pgdg.list \
    && groupadd --system --gid 999 postgres \
    && useradd --system --uid 999 --gid postgres --home-dir /var/lib/postgresql --shell /usr/sbin/nologin postgres \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      jq \
      "libpq5=${LIBPQ_PACKAGE_VERSION}" \
      "postgresql-client-common=${POSTGRES_COMMON_VERSION}" \
      "postgresql-client-17=${POSTGRES_PACKAGE_VERSION}" \
      util-linux \
    && rm -rf /var/lib/apt/lists/* /var/lib/postgresql
COPY --from=minio-client-builder /out/mc /usr/local/bin/mc
COPY --chmod=0555 backup-entrypoint.sh backup-loop.sh run-backup.sh restore-drill.sh restore-backup.sh integrity-lib.sh integrity-self-test.sh /opt/staging/
ENTRYPOINT ["/opt/staging/backup-entrypoint.sh"]
