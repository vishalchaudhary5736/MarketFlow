
FROM node:22-alpine AS base
WORKDIR /usr/src/app

ENV PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
COPY package.json package-lock.json ./

FROM base AS dependencies
RUN npm ci

COPY prisma ./prisma
COPY prisma.config.ts ./
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" npx prisma generate

# ---- Development: hot reload, used by docker-compose.dev.yml ----
# No source is COPYed in — docker-compose.dev.yml bind-mounts the host's
# working tree over /usr/src/app, so edits on the host are visible instantly.
# Keeps devDependencies (it builds on `dependencies`) because the Nest CLI and
# TypeScript have to run inside the container.
FROM dependencies AS development
ARG SERVICE_NAME
ENV SERVICE_NAME=${SERVICE_NAME}
ENV NODE_ENV=development
# Bind mounts on Docker Desktop do not reliably forward inotify events to the
# VM, so the watcher polls instead. Without this, edits are silently ignored.
ENV WATCHPACK_POLLING=true
ENV CHOKIDAR_USEPOLLING=true
# chokidar 4 spreads the caller's options over its own defaults, and the Nest
# CLI passes `interval: undefined` — which wipes out the default of 100 and
# makes fs.watchFile throw ERR_INVALID_ARG_TYPE the moment polling is on.
# CHOKIDAR_INTERVAL is applied after that spread, so it puts a number back.
ENV CHOKIDAR_INTERVAL=1000
CMD ["sh", "-c", "npx nest start ${SERVICE_NAME} --watch"]

# ---- Runtime deps: strip devDependencies, offline ----
FROM dependencies AS runtime-deps
RUN npm prune --omit=dev

FROM dependencies AS build
COPY . .
ARG SERVICE_NAME
RUN npx nest build ${SERVICE_NAME}

# ---- Production: lean runtime image, no dev tools, no source ----
FROM base AS production
ARG SERVICE_NAME
ENV SERVICE_NAME=${SERVICE_NAME}
ENV NODE_ENV=production
COPY --from=runtime-deps /usr/src/app/node_modules ./node_modules
COPY --from=runtime-deps /usr/src/app/prisma ./prisma

COPY --from=runtime-deps /usr/src/app/prisma.config.ts ./
COPY --from=build /usr/src/app/dist ./dist

# The real DATABASE_URL is injected at runtime by compose, never baked in.
CMD ["sh", "-c", "node dist/apps/${SERVICE_NAME}/main.js"]
