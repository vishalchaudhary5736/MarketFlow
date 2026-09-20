# syntax=docker/dockerfile:1

# One template builds every service. docker-compose passes a different
# SERVICE_NAME build arg per service; nothing else here is service-specific.
#
# SERVICE_NAME is declared as late as possible in each stage on purpose: every
# layer above it is byte-identical across all services, so BuildKit computes the
# npm installs and `prisma generate` once and shares the result. Declaring it
# earlier makes each service build its own copy, which means nine concurrent
# Prisma engine downloads and DNS failures.

# ---- Base: shared layer every stage builds on ----
FROM node:22-alpine AS base
WORKDIR /usr/src/app
COPY package.json package-lock.json ./

# ---- Dependencies: full deps (incl. devDependencies) needed to compile ----
FROM base AS dependencies
RUN npm ci

# ---- Build: compile the one service this image is for ----
FROM dependencies AS build
COPY . .
# `prisma generate` only reads the schema to emit TypeScript — it never opens a
# connection and needs no database URL.
RUN npx prisma generate
ARG SERVICE_NAME
RUN npx nest build ${SERVICE_NAME}

# ---- Prod deps: runtime dependencies only, shared by every service ----
FROM base AS prod-deps
# The schema must land before `npm ci`, because @prisma/client's postinstall
# looks for it, and before `generate`, which reads it.
COPY prisma ./prisma
RUN npm ci --omit=dev
RUN npx prisma generate

# ---- Production: lean runtime image, no dev tools, no source ----
FROM prod-deps AS production
ARG SERVICE_NAME
ENV SERVICE_NAME=${SERVICE_NAME}
ENV NODE_ENV=production
COPY --from=build /usr/src/app/dist ./dist

# The real DATABASE_URL is injected at runtime by compose (env_file), never
# baked into the image.
CMD ["sh", "-c", "node dist/apps/${SERVICE_NAME}/main.js"]
