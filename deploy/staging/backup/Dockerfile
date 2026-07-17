ARG MINIO_MC_IMAGE=minio/mc:RELEASE.2025-07-21T05-28-08Z
ARG POSTGRES_IMAGE=postgres:17.6-bookworm

FROM ${MINIO_MC_IMAGE} AS minio-client
FROM ${POSTGRES_IMAGE}
COPY --from=minio-client /usr/bin/mc /usr/local/bin/mc
COPY --chmod=0555 backup-entrypoint.sh backup-loop.sh run-backup.sh restore-drill.sh restore-backup.sh /opt/staging/
ENTRYPOINT ["/opt/staging/backup-entrypoint.sh"]
