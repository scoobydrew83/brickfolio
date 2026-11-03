# Multi-stage build: install → build → slim runtime with the standalone server.
FROM node:26-alpine AS deps
WORKDIR /app
# Build tools only in case better-sqlite3 has no prebuilt binary for this platform.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci

FROM node:26-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# public/ is optional in Next.js and not in the repo yet; create it so the COPY below always works.
RUN mkdir -p public && npm run build

FROM node:26-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    DATABASE_PATH=/data/app.db MIGRATIONS_DIR=/app/drizzle
# unzip: Settings → Download the LDraw library unpacks the parts library with it.
RUN apk add --no-cache unzip && addgroup -S app && adduser -S app -G app && mkdir -p /data && chown app:app /data
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/drizzle ./drizzle
COPY --from=build --chown=app:app /app/LICENSE /app/NOTICE /app/THIRD_PARTY_NOTICES.md ./
# For `node scripts/ldraw-download.mjs` inside the container (Coolify: Execute command).
COPY --from=build --chown=app:app /app/scripts/ldraw-download.mjs ./scripts/ldraw-download.mjs
COPY --from=build --chown=app:app /app/lib/ldraw/install.mjs ./lib/ldraw/install.mjs
# Optimized BrickLink images are cached here; compose mounts a volume so they survive rebuilds.
RUN mkdir -p .next/cache/images && chown -R app:app .next/cache
USER app
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" || exit 1
CMD ["node", "server.js"]
