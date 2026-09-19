# syntax=docker/dockerfile:1

# ---- Base: shared layer every stage builds on ----
FROM node:22-alpine AS base
WORKDIR /usr/src/app
COPY package.json package-lock.json ./

# ---- Dependencies: install full deps (incl. devDependencies) needed to build ----
FROM base AS dependencies
RUN npm ci

# ---- Build: compile the one service this image is for ----
FROM dependencies AS build
ARG SERVICE_NAME
COPY . .
# prisma generate only reads the schema to produce code — it never connects,
# so a placeholder DATABASE_URL is enough to satisfy its env-var check at build time.
RUN if [ "$SERVICE_NAME" = "auth-service" ]; then \
      DATABASE_URL="postgresql://user:password@localhost:5432/placeholder" npx prisma generate; \
    fi
RUN npx nest build ${SERVICE_NAME}

# ---- Production: lean runtime image, no dev tools, no source ----
FROM base AS production
ARG SERVICE_NAME
ENV SERVICE_NAME=${SERVICE_NAME}
ENV NODE_ENV=production
COPY prisma ./prisma
RUN npm ci --omit=dev
RUN if [ "$SERVICE_NAME" = "auth-service" ]; then \
      DATABASE_URL="postgresql://user:password@localhost:5432/placeholder" npx prisma generate; \
    fi
COPY --from=build /usr/src/app/dist ./dist

CMD ["sh", "-c", "node dist/apps/${SERVICE_NAME}/main.js"]
