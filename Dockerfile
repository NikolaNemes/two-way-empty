# syntax=docker/dockerfile:1.7
# ════════════════════════════════════════════════════════════════════════════
# Amperio Dispatch — one image, two runtime targets.
#
# A single `runtime` image serves both processes — the Next.js dashboard and
# the dispatch worker — selected at deploy time by the working directory:
#
#   /app                        → Next.js dashboard + API/cron/dispatcher routes
#   /app/services/dispatch-worker → persistent 15s dispatch loop
#
# The image ships the FULL repo tree because:
#   • glpk.js is in next.config.mjs `serverExternalPackages`, so its .wasm is
#     required from node_modules at runtime — the app cannot run from a pruned
#     standalone bundle.
#   • the worker imports ../../../lib/*.ts (dispatch-kernel, price-supply), so
#     it needs the root `lib/` dir AND the root node_modules on the resolution
#     path above services/dispatch-worker.
# ════════════════════════════════════════════════════════════════════════════

FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
# lockfileVersion 9.0 → pnpm 10.x
RUN npm install -g pnpm@10 && npm cache clean --force
WORKDIR /app


# ── Dependencies ────────────────────────────────────────────────────────────
# Two separate installs: the worker has its own package.json + lockfile.
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY services/dispatch-worker/package.json services/dispatch-worker/pnpm-lock.yaml ./services/dispatch-worker/
RUN cd services/dispatch-worker && pnpm install --frozen-lockfile


# ── Build ───────────────────────────────────────────────────────────────────
# NEXT_PUBLIC_* vars are inlined into the client bundle at BUILD time, so the
# Clerk publishable key must be a build arg — setting it only at runtime leaves
# the browser bundle with an empty key and every Clerk component dead.
#
# It is the ONLY build arg: DATABASE_URL and CLERK_SECRET_KEY are supplied at
# RUNTIME via env_file, so they never enter the image history. This holds as
# long as nothing is prerendered that queries the DB or calls auth() — the
# Drizzle pool in lib/db/index.ts is memoized lazily and throws only on first
# query, so a violation fails the build loudly rather than shipping silently.
FROM deps AS build
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \
    NODE_ENV=production
COPY . .
# next/font/google downloads Geist at build time — the builder needs network.
RUN pnpm build


# ── Runtime ─────────────────────────────────────────────────────────────────
# ONE runtime image for both processes. They share the same tree and the same
# `pnpm start`; only the working directory differs, so the caller picks which
# process the container runs:
#
#   app     → (default) WORKDIR /app                        → next start
#   worker  → working_dir /app/services/dispatch-worker     → tsx src/worker.ts
#
# No HEALTHCHECK here: it would be inherited by worker containers, which serve
# no HTTP and would be permanently unhealthy. The app's liveness probe lives in
# docker-compose.yml instead. Readiness (Redis + Amperio reachability) is at
# /api/dispatcher/ready — monitor that, but don't restart the container on it.
FROM base AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
CMD ["pnpm", "start"]
