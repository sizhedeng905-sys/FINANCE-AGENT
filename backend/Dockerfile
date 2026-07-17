ARG NODE_IMAGE=node:24.18.0-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001
WORKDIR /app
RUN groupadd --gid 10001 finance \
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
