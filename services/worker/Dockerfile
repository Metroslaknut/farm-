# FARM+ worker image. Build from the REPOSITORY ROOT:  docker build -f services/worker/Dockerfile -t farmplus-worker .
# NOTE: written for review and not built in the environment where it was authored (no Docker available there).

FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY services/worker ./services/worker
RUN pnpm install --frozen-lockfile --filter @farmplus/worker...
RUN pnpm --filter @farmplus/worker build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY services/worker/package.json ./services/worker/package.json
RUN pnpm install --frozen-lockfile --prod --filter @farmplus/worker... && pnpm store prune
COPY --from=build /repo/services/worker/dist ./services/worker/dist
ARG GIT_SHA
ENV GIT_SHA=${GIT_SHA}
USER node
WORKDIR /app/services/worker
# Optional liveness endpoint (set WORKER_HEALTH_PORT to enable): bind it to the private network only.
STOPSIGNAL SIGTERM
CMD ["node", "dist/index.js"]
