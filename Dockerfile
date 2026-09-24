# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9

FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS builder
COPY . .
RUN npm run build
RUN node scripts/prepare-standalone.mjs

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
LABEL org.opencontainers.image.title="Yanvah Control" \
    org.opencontainers.image.description="Private, self-hosted SaaS administration through signed Yanvah Control connections" \
    org.opencontainers.image.licenses="Apache-2.0"
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/control.db \
    TMPDIR=/data/tmp
RUN groupadd --gid 10001 control && useradd --uid 10001 --gid control --no-create-home --shell /usr/sbin/nologin control \
    && mkdir -p /data && chown control:control /data \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=builder /app/.next/standalone/ ./
COPY --from=builder /app/.next/static/ ./.next/static/
COPY --from=builder /app/public/ ./public/
COPY --from=builder /app/src/db/migrations/ ./src/db/migrations/
COPY --from=builder /app/.container-scripts/ ./scripts/
COPY --from=builder /app/.container-licenses/ ./licenses/
COPY LICENSE SECURITY.md ./
COPY docker/entrypoint.sh docker/healthcheck.mjs docker/preflight.mjs ./docker/
RUN chmod 0555 ./docker/entrypoint.sh && rm -rf /app/.next/cache && ln -s /data/cache /app/.next/cache
USER 10001:10001
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "docker/healthcheck.mjs"]
ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["node", "server.js"]
