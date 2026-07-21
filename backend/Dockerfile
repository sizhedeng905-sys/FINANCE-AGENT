ARG NODE_IMAGE=node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d
ARG BUILD_GIT_SHA=unverified
ARG CA_CERTIFICATES_PACKAGE_VERSION=20230311+deb12u1
ARG LIBSSL_PACKAGE_VERSION=3.0.20-1~deb12u2
ARG OPENSSL_PACKAGE_VERSION=3.0.20-1~deb12u2

FROM ${NODE_IMAGE} AS node-base
ARG CA_CERTIFICATES_PACKAGE_VERSION
ARG LIBSSL_PACKAGE_VERSION
ARG OPENSSL_PACKAGE_VERSION
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      "ca-certificates=${CA_CERTIFICATES_PACKAGE_VERSION}" \
      "libssl3=${LIBSSL_PACKAGE_VERSION}" \
      "openssl=${OPENSSL_PACKAGE_VERSION}" \
    && rm -rf /var/lib/apt/lists/*

FROM node-base AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node-base AS runtime
ARG BUILD_GIT_SHA
LABEL org.opencontainers.image.revision=${BUILD_GIT_SHA}
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001
WORKDIR /app
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    && groupadd --gid 10001 finance \
    && useradd --uid 10001 --gid finance --no-create-home --shell /usr/sbin/nologin finance \
    && mkdir -p /app/.upload-quarantine \
    && chown -R finance:finance /app
COPY --from=build --chown=finance:finance /app/package.json /app/package-lock.json ./
COPY --from=build --chown=finance:finance /app/node_modules ./node_modules
COPY --from=build --chown=finance:finance /app/dist ./dist
COPY --from=build --chown=finance:finance /app/prisma ./prisma
COPY --chmod=0555 docker/backend-entrypoint.sh /usr/local/bin/backend-entrypoint
USER 10001:10001
EXPOSE 3001
ENTRYPOINT ["backend-entrypoint"]
CMD ["node", "dist/main.js"]
