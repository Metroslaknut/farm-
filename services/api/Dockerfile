# FARM+ API image. Build from the REPOSITORY ROOT:  docker build -f services/api/Dockerfile -t farmplus-api .
# NOTE: written for review and not built in the environment where it was authored (no Docker available there).
# Build it once in CI and run `docker run --rm farmplus-api node dist/scripts/env-check.js` with a staging env before relying on it.

FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY services/api ./services/api
RUN pnpm install --frozen-lockfile --filter @farmplus/api...
RUN pnpm --filter @farmplus/api build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
# Production dependencies only. Workspace packages are bundled into dist/, but pnpm still needs their manifests to resolve.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY services/api/package.json ./services/api/package.json
RUN pnpm install --frozen-lockfile --prod --filter @farmplus/api... && pnpm store prune
COPY --from=build /repo/services/api/dist ./services/api/dist
# Secrets are NEVER baked into the image: they arrive as environment variables at run time.
ARG GIT_SHA
ENV GIT_SHA=${GIT_SHA}
USER node
WORKDIR /app/services/api
EXPOSE 4000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
