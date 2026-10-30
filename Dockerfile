# syntax=docker/dockerfile:1
#
# One Dockerfile for every server app in the monorepo; pick the app with --target:
#
#   docker build --target api    -t parakeet-api .
#   docker build --target worker -t parakeet-worker .
#   docker build --target web    -t parakeet-web   --build-arg NEXT_PUBLIC_API_URL=… --build-arg NEXT_PUBLIC_SUPABASE_URL=… …
#   docker build --target admin  -t parakeet-admin --build-arg NEXT_PUBLIC_API_URL=…
#   docker build --target jobs   -t parakeet-jobs  --build-arg NEXT_PUBLIC_JOBS_SITE_URL=… (+ the API and Supabase args, as for web)
#
# NEXT_PUBLIC_* values are compiled into the web/admin/jobs bundles, so they are build args, not runtime
# env. Runtime secrets (DATABASE_URL, API keys…) are never baked in; they come from the environment.
# deploy/compose.yml and .github/workflows/deploy.yml pass all of this for you.

ARG NODE_IMAGE=node:24-bookworm-slim

# ---------------------------------------------------------------------------------------------------
# base: Node + the pnpm version pinned in package.json "packageManager"
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1 \
    CI=1
RUN corepack enable
WORKDIR /repo

# ---------------------------------------------------------------------------------------------------
# deps: install from manifests only, so source edits don't invalidate this layer. The pnpm store is a
# cache mount, so re-installs after a lockfile change only download what changed.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json      apps/api/
COPY apps/worker/package.json   apps/worker/
COPY apps/web/package.json      apps/web/
COPY apps/admin/package.json    apps/admin/
COPY apps/jobs/package.json     apps/jobs/
COPY apps/desktop/package.json  apps/desktop/
COPY packages/shared/package.json packages/shared/
COPY packages/emails/package.json packages/emails/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter '!@parakeet/desktop'

# source: deps + the code (shared by every build stage below)
FROM deps AS source
COPY . .

# ---------------------------------------------------------------------------------------------------
# Node services (api, worker): compile in `source`, and install production deps separately, straight
# from the lockfile, with only the manifests this service needs, so nothing from web/admin/jobs leaks in.
FROM source AS build-node
RUN pnpm --filter @parakeet/shared --filter @parakeet/emails --filter @parakeet/api --filter @parakeet/worker \
      exec tsc -p tsconfig.json

FROM base AS prod-deps-api
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json        apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/emails/package.json packages/emails/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter '@parakeet/api...'

FROM base AS prod-deps-worker
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker/package.json     apps/worker/
COPY packages/shared/package.json packages/shared/
COPY packages/emails/package.json packages/emails/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter '@parakeet/worker...'

# ---------------------------------------------------------------------------------------------------
# Next.js apps: standalone output (server.js + only the traced node_modules).
FROM source AS build-web
ARG NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_DOWNLOADS_URL \
    NEXT_PUBLIC_DESKTOP_VERSION \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY \
    NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION \
    NEXT_PUBLIC_BING_SITE_VERIFICATION \
    NEXT_PUBLIC_META_PIXEL_ID
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_DOWNLOADS_URL=$NEXT_PUBLIC_DOWNLOADS_URL \
    NEXT_PUBLIC_DESKTOP_VERSION=$NEXT_PUBLIC_DESKTOP_VERSION \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=$NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION \
    NEXT_PUBLIC_BING_SITE_VERIFICATION=$NEXT_PUBLIC_BING_SITE_VERIFICATION \
    NEXT_PUBLIC_META_PIXEL_ID=$NEXT_PUBLIC_META_PIXEL_ID
# Fail the build rather than ship a site that talks to localhost.
RUN : "${NEXT_PUBLIC_API_URL:?build arg required}" \
      "${NEXT_PUBLIC_SUPABASE_URL:?build arg required}" \
      "${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:?build arg required}" \
 && pnpm --filter @parakeet/shared exec tsc -p tsconfig.json \
 && pnpm --filter @parakeet/web run build

FROM source AS build-admin
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN : "${NEXT_PUBLIC_API_URL:?build arg required}" \
 && pnpm --filter @parakeet/shared exec tsc -p tsconfig.json \
 && pnpm --filter @parakeet/admin run build

FROM source AS build-jobs
ARG NEXT_PUBLIC_JOBS_SITE_URL \
    NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY \
    NEXT_PUBLIC_WEB_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_JOBS_SITE_URL \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY \
    NEXT_PUBLIC_WEB_URL=$NEXT_PUBLIC_WEB_URL
# Signed-in pages call the API and Supabase from the browser.
RUN : "${NEXT_PUBLIC_API_URL:?build arg required}" \
      "${NEXT_PUBLIC_SUPABASE_URL:?build arg required}" \
      "${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:?build arg required}" \
 && pnpm --filter @parakeet/shared exec tsc -p tsconfig.json \
 && pnpm --filter @parakeet/jobs run build

# ---------------------------------------------------------------------------------------------------
# runtime: slim image, no pnpm or compilers, non-root. Code is root-owned so the app can't modify it.
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
ARG GIT_SHA=dev
LABEL org.opencontainers.image.source="https://github.com/arvindydv/interview-ai" \
      org.opencontainers.image.revision=$GIT_SHA
ENV GIT_SHA=$GIT_SHA

FROM runtime AS api
COPY --from=prod-deps-api /repo ./
COPY --from=build-node /repo/packages/shared/dist packages/shared/dist
COPY --from=build-node /repo/packages/emails/dist packages/emails/dist
COPY --from=build-node /repo/apps/api/dist        apps/api/dist
WORKDIR /app/apps/api
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/livez').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/index.js"]

FROM runtime AS worker
COPY --from=prod-deps-worker /repo ./
COPY --from=build-node /repo/packages/shared/dist packages/shared/dist
COPY --from=build-node /repo/packages/emails/dist packages/emails/dist
COPY --from=build-node /repo/apps/worker/dist     apps/worker/dist
WORKDIR /app/apps/worker
USER node
CMD ["node", "dist/index.js"]

FROM runtime AS web
COPY --from=build-web /repo/apps/web/.next/standalone ./
COPY --from=build-web /repo/apps/web/.next/static ./apps/web/.next/static
# Next writes its runtime cache here.
RUN mkdir -p apps/web/.next/cache && chown node:node apps/web/.next/cache
USER node
ENV PORT=3100 HOSTNAME=0.0.0.0
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3100/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]

FROM runtime AS admin
COPY --from=build-admin /repo/apps/admin/.next/standalone ./
COPY --from=build-admin /repo/apps/admin/.next/static ./apps/admin/.next/static
RUN mkdir -p apps/admin/.next/cache && chown node:node apps/admin/.next/cache
USER node
ENV PORT=3200 HOSTNAME=0.0.0.0
EXPOSE 3200
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3200/login').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/admin/server.js"]

FROM runtime AS jobs
COPY --from=build-jobs /repo/apps/jobs/.next/standalone ./
COPY --from=build-jobs /repo/apps/jobs/.next/static ./apps/jobs/.next/static
RUN mkdir -p apps/jobs/.next/cache && chown node:node apps/jobs/.next/cache
USER node
ENV PORT=3300 HOSTNAME=0.0.0.0
EXPOSE 3300
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3300/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/jobs/server.js"]
