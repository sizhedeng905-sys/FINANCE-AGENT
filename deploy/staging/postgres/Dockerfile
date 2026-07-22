ARG DEBIAN_IMAGE=debian:bookworm-slim@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818
ARG POSTGRES_PACKAGE_VERSION=17.10-1.pgdg12+1
ARG POSTGRES_COMMON_VERSION=293.pgdg12+1
ARG LIBPQ_PACKAGE_VERSION=18.4-1.pgdg12+1
ARG POSTGRES_ENTRYPOINT_SHA256=9c440299ae04a0a79d55b8bf03307036d890a40979d2fb698073c9050d4b20a5
ARG POSTGRES_ENTRYPOINT_COMMIT=62a714f93cc32220de46fd12235c9d509e3b1ad6
ARG POSTGRES_SIGNING_KEY_SHA256=0144068502a1eddd2a0280ede10ef607d1ec592ce819940991203941564e8e76

FROM ${DEBIAN_IMAGE}
ARG BUILD_GIT_SHA=unverified
ARG POSTGRES_PACKAGE_VERSION
ARG POSTGRES_COMMON_VERSION
ARG LIBPQ_PACKAGE_VERSION
ARG POSTGRES_ENTRYPOINT_SHA256
ARG POSTGRES_ENTRYPOINT_COMMIT
ARG POSTGRES_SIGNING_KEY_SHA256
LABEL org.opencontainers.image.revision=${BUILD_GIT_SHA} \
      io.finance-agent.postgres.package-version=${POSTGRES_PACKAGE_VERSION} \
      io.finance-agent.postgres.entrypoint-revision=${POSTGRES_ENTRYPOINT_COMMIT} \
      io.finance-agent.postgres.entrypoint-sha256=${POSTGRES_ENTRYPOINT_SHA256} \
      io.finance-agent.postgres.pgdg-key-sha256=${POSTGRES_SIGNING_KEY_SHA256}

ENV LANG=C.UTF-8 \
    PGDATA=/var/lib/postgresql/data \
    PATH=/usr/lib/postgresql/17/bin:$PATH

ADD --checksum=sha256:${POSTGRES_ENTRYPOINT_SHA256} \
    https://raw.githubusercontent.com/docker-library/postgres/${POSTGRES_ENTRYPOINT_COMMIT}/17/bookworm/docker-entrypoint.sh \
    /usr/local/bin/docker-entrypoint.sh
ADD --checksum=sha256:${POSTGRES_SIGNING_KEY_SHA256} \
    https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    /usr/local/share/keyrings/postgres.gpg.asc

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates gpgv \
    && rm -rf /var/lib/apt/lists/*

RUN echo "${POSTGRES_ENTRYPOINT_SHA256}  /usr/local/bin/docker-entrypoint.sh" | sha256sum --check --strict \
    && echo "${POSTGRES_SIGNING_KEY_SHA256}  /usr/local/share/keyrings/postgres.gpg.asc" | sha256sum --check --strict \
    && chmod 0555 /usr/local/bin/docker-entrypoint.sh \
    && chmod 0644 /usr/local/share/keyrings/postgres.gpg.asc \
    && sed -i 's/exec gosu postgres "\$BASH_SOURCE" "\$@"/exec runuser -u postgres --preserve-environment -- "\$BASH_SOURCE" "\$@"/' /usr/local/bin/docker-entrypoint.sh \
    && ! grep -q 'exec gosu postgres' /usr/local/bin/docker-entrypoint.sh \
    && printf 'deb [signed-by=/usr/local/share/keyrings/postgres.gpg.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main\n' > /etc/apt/sources.list.d/pgdg.list \
    && printf 'create_main_cluster = false\n' > /etc/postgresql-common-createcluster.conf \
    && groupadd --system --gid 999 postgres \
    && useradd --system --uid 999 --gid postgres --home-dir /var/lib/postgresql --shell /bin/bash postgres \
    && apt-get update \
    && install -D -m 0644 /etc/postgresql-common-createcluster.conf /etc/postgresql-common/createcluster.conf \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      -o Dpkg::Options::="--force-confold" \
      "libpq5=${LIBPQ_PACKAGE_VERSION}" \
      "postgresql-client-common=${POSTGRES_COMMON_VERSION}" \
      "postgresql-common=${POSTGRES_COMMON_VERSION}" \
      "postgresql-client-17=${POSTGRES_PACKAGE_VERSION}" \
      "postgresql-17=${POSTGRES_PACKAGE_VERSION}" \
    && rm -rf /var/lib/apt/lists/* /var/lib/postgresql/17 \
    && install -d -o postgres -g postgres -m 0700 /var/lib/postgresql/data \
    && install -d -o postgres -g postgres -m 3775 /var/run/postgresql \
    && install -d -m 0755 /docker-entrypoint-initdb.d

EXPOSE 5432
STOPSIGNAL SIGINT
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["postgres"]
