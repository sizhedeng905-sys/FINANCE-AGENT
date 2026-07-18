ARG MINIO_MC_IMAGE=minio/mc:RELEASE.2025-07-21T05-28-08Z
ARG POSTGRES_IMAGE=postgres:17.6-bookworm

FROM ${MINIO_MC_IMAGE} AS minio-client
FROM ${POSTGRES_IMAGE}
RUN apt-get update \
    && apt-get install -y --no-install-recommends jq \
    && rm -rf /var/lib/apt/lists/*
COPY --from=minio-client /usr/bin/mc /usr/local/bin/mc
COPY --chmod=0555 backup-entrypoint.sh backup-loop.sh run-backup.sh restore-drill.sh restore-backup.sh integrity-lib.sh integrity-self-test.sh /opt/staging/
ENTRYPOINT ["/opt/staging/backup-entrypoint.sh"]
