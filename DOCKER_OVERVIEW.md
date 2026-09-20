# Docker Overview

How this repository is containerised: what `Dockerfile` and `docker-compose.yml`
each do, how one template produces nine service images, what happens step by
step when you run `docker compose up --build`, and how the running containers
reach the cloud database and cache.

---

## 1. The system at a glance

Nine independent NestJS applications live in one monorepo. Each runs as its own
container, on its own port, from its own image — but all nine images are built
from a single `Dockerfile`.

```
                    Your machine (host)
 ┌──────────────────────────────────────────────────────────┐
 │  docker network: ecommerce-net (bridge)                  │
 │                                                          │
 │   api-gateway   :3000      order-service      :3006      │
 │   auth-service  :3001      payment-service    :3007      │
 │   cart-service  :3002      analytics-service  :3008      │
 │   catalog-service   :3003                                │
 │   inventory-service :3004                                │
 │   notification-svc  :3005                                │
 └──────────────────────────┬───────────────────────────────┘
                            │ outbound TLS
                            ▼
       ┌─────────────────────────────────────────┐
       │  Neon (PostgreSQL)   ap-southeast-1     │
       │  Redis Cloud                            │
       └─────────────────────────────────────────┘
```

There is **no database container**. Postgres and Redis were removed from
`docker-compose.yml` when the project moved to Neon and Redis Cloud. Both are
external services reached over the internet.

---

## 2. The one idea you need first: build time vs run time

Almost every Docker confusion comes from mixing these up.

|                     | **Build time**                     | **Run time**                     |
| ------------------- | ---------------------------------- | -------------------------------- |
| Triggered by        | `docker compose build`             | `docker compose up`              |
| Produces            | an **image** (a frozen filesystem) | a **container** (a live process) |
| Reads               | `Dockerfile`                       | `docker-compose.yml` + env file  |
| Touches a database? | **Never**                          | Yes — connects to Neon           |
| Runs how often      | once per code change               | every time the container starts  |

An image is a sealed lunchbox. A container is eating the lunch. Packing the box
does not require a kitchen — which is why the `Dockerfile` contains no database
connection string anywhere.

Everything written in the `Dockerfile` happens at build time, **except** the
final `CMD`, which is the first thing to execute at run time.

---

## 3. The Dockerfile, stage by stage

Each `FROM` begins a new **stage**. Stages can copy files from one another, and
only the final stage becomes the shipped image. Everything else is scaffolding
that gets thrown away. This is called a _multi-stage build_, and it is why the
final images do not contain TypeScript, the Nest CLI, or your `.ts` source.

### Stage 1 — `base`

```dockerfile
FROM node:22-alpine AS base
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
```

- `node:22-alpine` — Node 22 on Alpine Linux, a minimal distro. Much smaller
  than the Debian-based default image.
- `WORKDIR` — every later command runs from `/usr/src/app`, and it is created if
  missing.
- Only the two dependency files are copied, **not** the source.

That last point is a deliberate caching trick. Docker caches each instruction as
a layer and reuses it when nothing above changed. Dependencies change rarely,
source changes constantly. Copying them separately means editing a `.ts` file
does not invalidate the expensive `npm ci` layer below.

### Stage 2 — `dependencies`

```dockerfile
FROM base AS dependencies
RUN npm ci
```

Installs **everything**, including `devDependencies`, because compiling needs
TypeScript, webpack, and the Nest CLI.

`npm ci` rather than `npm install`: it installs exactly what `package-lock.json`
specifies, fails if the lockfile and `package.json` disagree, and never rewrites
the lockfile. Reproducible builds.

### Stage 3 — `build`

```dockerfile
FROM dependencies AS build
COPY . .
RUN npx prisma generate
ARG SERVICE_NAME
RUN npx nest build ${SERVICE_NAME}
```

Now the source is copied in (minus whatever `.dockerignore` excludes).

`npx prisma generate` reads `prisma/schema.prisma` and **writes TypeScript** into
`node_modules/.prisma/client`. It reads a file and writes a file. It opens no
network connection and needs no `DATABASE_URL` — this was verified directly:

```
$ npx prisma generate          # with no DATABASE_URL set at all
✔ Generated Prisma Client (v6.19.3) in 178ms
```

`npx nest build ${SERVICE_NAME}` compiles **one** application. The monorepo's
`nest-cli.json` has a `projects` map naming all nine, so `nest build auth-service`
emits only `dist/apps/auth-service/`.

`SERVICE_NAME` is the single per-service difference in this whole file.

### Stage 4 — `prod-deps`

```dockerfile
FROM base AS prod-deps
COPY prisma ./prisma
RUN npm ci --omit=dev
RUN npx prisma generate
```

A **fresh** install starting from `base` again, this time with `--omit=dev`. No
TypeScript, no webpack, no Jest. The compiler was needed in stage 3 and is now
discarded — this is the main reason the final image stays reasonable.

Order matters here. `COPY prisma` must precede `npm ci` because
`@prisma/client`'s postinstall script looks for the schema, and it must precede
`generate` for the obvious reason.

### Stage 5 — `production`

```dockerfile
FROM prod-deps AS production
ARG SERVICE_NAME
ENV SERVICE_NAME=${SERVICE_NAME}
ENV NODE_ENV=production
COPY --from=build /usr/src/app/dist ./dist

CMD ["sh", "-c", "node dist/apps/${SERVICE_NAME}/main.js"]
```

`COPY --from=build` reaches back into stage 3 and takes **only** `dist/`. The
source tree, devDependencies, and build tooling never enter the final image.

`ARG` vs `ENV` — worth knowing the difference:

- `ARG SERVICE_NAME` exists **only during the build**. It vanishes from the image.
- `ENV SERVICE_NAME=...` **persists into the running container**, which is what
  makes `${SERVICE_NAME}` resolvable inside `CMD` at run time.

That promotion from `ARG` to `ENV` is why the same `CMD` line works for all nine
services.

`CMD` is wrapped in `sh -c` on purpose. Without a shell, `${SERVICE_NAME}` would
be passed to `node` as a literal string rather than expanded.

### Why `ARG SERVICE_NAME` sits so low in each stage

This is not cosmetic. Every layer **after** an `ARG` is considered
service-specific by BuildKit, so it cannot be shared between the nine builds.

An earlier version declared `ARG SERVICE_NAME` at the top of the build and
production stages. The result: `npm ci --omit=dev` and `prisma generate` were
computed nine separate times, in parallel — eighteen simultaneous Prisma engine
downloads, which saturated DNS and failed the build outright:

```
Error: getaddrinfo EAI_AGAIN binaries.prisma.sh
target analytics-service: failed to solve: "npx prisma generate" exit code 1
```

Keeping the `ARG` below the shared work means every layer above it is
byte-identical across all nine services, so BuildKit computes it **once**.

---

## 4. The docker-compose.yml

Where the `Dockerfile` describes _how to build one image_, compose describes
_what to run and how to wire it up_. Every service block has the same five keys:

```yaml
auth-service:
  build:
    context: .
    args:
      SERVICE_NAME: auth-service
  env_file: .env
  restart: unless-stopped
  ports:
    - '${AUTH_SERVICE_PORT}:${AUTH_SERVICE_PORT}'
  networks:
    - ecommerce-net
```

**`build.context: .`** — the build context is the project root. Everything in it
is sent to the Docker daemon as the build's filesystem, minus `.dockerignore`
entries. This is why `COPY . .` in stage 3 sees your whole repo.

**`build.args.SERVICE_NAME`** — fills in the `ARG` in the Dockerfile. This one
line is what turns a generic template into `auth-service`'s image. Nine services,
nine different values, one Dockerfile.

**`env_file`** — at **run time**, every variable in the environment file is
injected into the container's environment. This is how `DATABASE_URL`, the Redis
credentials, and the JWT secrets arrive. Nothing is written to disk inside the
container; the values live only in that process's environment.

**`restart: unless-stopped`** — if the process exits (a crash, an unreachable
Neon instance during cold start), Docker restarts it. It stays down only if you
stopped it deliberately.

**`ports: "${AUTH_SERVICE_PORT}:${AUTH_SERVICE_PORT}"`** — maps `host:container`.
Both sides read from the same variable, so one value controls both. Note that
compose resolves `${...}` placeholders from the environment file **in the project
root at the moment you run the command** — that is a separate mechanism from
`env_file`, which concerns the container's own environment.

**`networks: ecommerce-net`** — all nine join one user-defined bridge network.
Inside it, containers reach each other **by service name**: the api-gateway can
call `http://auth-service:3001` with no IP addresses involved. Docker runs an
internal DNS server that resolves those names.

At the bottom:

```yaml
networks:
  ecommerce-net:
    driver: bridge
```

`bridge` is the standard driver for single-host setups — a private virtual
network with NAT out to the internet.

### What is deliberately absent

- **No `volumes:`** — nothing is persisted, because nothing stateful runs here.
  State lives in Neon and Redis Cloud.
- **No `depends_on:`** — the services do not currently call each other at startup.
- **No `healthcheck:`** — worth adding later; see §9.

---

## 5. Full flow: `docker compose up --build`

1. **Compose reads `docker-compose.yml`** and substitutes `${...}` placeholders
   from the project-root environment file. A missing variable becomes an empty
   string, which produces a confusing `ports: ":"` error rather than a clear one.

2. **The build context is packaged.** Everything under `.` is collected, minus
   `.dockerignore` entries (`node_modules`, `dist`, `.git`, the environment file,
   `*.md`, …). Excluding `node_modules` matters: the host copy contains
   Linux-incompatible native binaries, and it would be overwritten by `npm ci`
   regardless.

3. **BuildKit builds nine images in parallel.** Shared stages (`base`,
   `dependencies`, `prod-deps`) are computed once and reused. Only
   `nest build ${SERVICE_NAME}` and the final `ENV`/`COPY` differ per service.

4. **Each container is created and started.** Docker creates the `ecommerce-net`
   network first if it does not exist, then attaches each container to it,
   applies the port mappings, and injects the environment.

5. **`CMD` fires**, running `node dist/apps/<service>/main.js`.

6. **Inside the Node process**, `main.ts` runs:

   ```ts
   import 'dotenv/config'; // 1
   const app = await NestFactory.create(AuthServiceModule);
   app.useGlobalPipes(new ValidationPipe({ whitelist: true /* … */ }));
   await app.listen(process.env.AUTH_SERVICE_PORT ?? 3001);
   ```

   `dotenv/config` is imported **first**, before any other import, because
   CommonJS evaluates imports top to bottom and NestJS module decorators read
   `process.env` the moment they are evaluated. Import it late and the config is
   read before it exists. In containers the environment is already populated by
   compose, so this is mostly a safety net for running outside Docker.

7. **Nest builds the dependency graph.** Every provider is constructed here —
   which is why a missing module import fails at _startup_, not at compile time:

   ```
   Nest can't resolve dependencies of the AuthService (CacheService, PrismaService, ?).
   ```

8. **`PrismaService.onModuleInit()` connects to Neon**, with a five-attempt retry
   and increasing backoff, because a paused Neon instance takes a few seconds to
   wake:

   ```
   Database connection attempt 1/5 failed (likely a cold-starting Neon
   instance). Retrying in 2000ms...
   ```

9. **The HTTP server listens**, routes are mapped, and the service is live:

   ```
   [RouterExplorer] Mapped {/auth/register, POST} route
   [NestApplication] Nest application successfully started +1647ms
   ```

---

## 6. How the cloud database actually connects

The full path, from your file to an open socket:

```
environment file  (on your machine, never copied into the image)
  │
  │  docker-compose.yml:  env_file
  ▼
container environment:  DATABASE_URL=postgresql://…neon.tech/marketFlow?sslmode=require
  │
  │  prisma/schema.prisma:  url = env("DATABASE_URL")
  ▼
PrismaClient  (generated code stores the variable NAME, not the value)
  │
  │  PrismaService.onModuleInit() → this.$connect()
  ▼
Neon, over TLS
```

Verified from inside a running container:

```
$ docker compose exec auth-service printenv DATABASE_URL
postgresql://***:***@ep-summer-shape-b305ad1c-pooler.c-4.ap-southeast-1.aws.neon.tech/marketFlow?sslmode=require&channel_binding=require
```

### Why the environment file is dockerignored yet still works

These are two unrelated mechanisms, and confusing them is extremely common:

| Mechanism       | When       | What it does                                               |
| --------------- | ---------- | ---------------------------------------------------------- |
| `.dockerignore` | build time | Excludes files from the image. Credentials never baked in. |
| `env_file:`     | run time   | Injects variables into the live container's environment.   |

Credentials stay out of the image — so pushing it to a registry leaks nothing —
and the application still receives them. That separation is the entire point.

### Why the generated Prisma client is not a leak either

`prisma generate` stores the **environment variable name** in the generated code,
not its value. The URL is resolved fresh each time the client starts. A grep
inside the built image confirms no connection string is present.

### The Redis Cloud connection follows the same pattern

`auth.module.ts` builds the connection string from environment variables at
module-initialisation time:

```ts
createKeyv(
  `redis://${process.env.REDIS_USERNAME ?? ''}:${process.env.REDIS_PASSWORD ?? ''}` +
    `@${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
);
```

Redis Cloud requires authentication — without `REDIS_USERNAME` and
`REDIS_PASSWORD` the connection fails with `NOAUTH Authentication required`, and
caching silently does nothing.

### Running Prisma migrations: use a container

The host cannot reach Neon. Host DNS resolves it to an IPv6-only address and IPv6
egress is broken locally; containers get IPv4. So migrations run inside a
throwaway container, with `prisma/` mounted so new migration folders land back on
the host:

```bash
docker compose run --rm --no-deps \
  -v "$PWD/prisma:/usr/src/app/prisma" \
  auth-service npx prisma migrate deploy
```

- `--rm` deletes the container afterwards
- `--no-deps` does not start or restart any other service
- the `-v` mount is what makes generated files persist

**Then regenerate on the host**, because the container's `node_modules` is
discarded with it:

```bash
npx prisma generate
```

Skipping that second step leaves your editor type-checking against a stale client
— the symptom is TypeScript insisting a field you can plainly see in
`schema.prisma` does not exist.

---

## 7. How one Dockerfile makes nine images

```
                        Dockerfile
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
  SERVICE_NAME=       SERVICE_NAME=       SERVICE_NAME=
  api-gateway         auth-service        cart-service      … ×9
        │                   │                   │
  nest build          nest build          nest build
  api-gateway         auth-service        cart-service
        │                   │                   │
  dist/apps/          dist/apps/          dist/apps/
  api-gateway/        auth-service/       cart-service/
        │                   │                   │
  node …/api-         node …/auth-        node …/cart-
  gateway/main.js     service/main.js     service/main.js
```

Everything above the `ARG SERVICE_NAME` line is shared. Everything below it
diverges. Images land around 519 MB each, and because the lower layers are
identical, Docker stores them **once** on disk regardless of how many services
use them.

---

## 8. Command reference

```bash
# Build everything and start it, detached
docker compose up -d --build

# Start without rebuilding
docker compose up -d

# Rebuild a single service
docker compose build auth-service

# Status of all containers
docker compose ps

# Follow logs — all services, or one
docker compose logs -f
docker compose logs -f auth-service

# Last 50 lines from one service
docker compose logs --tail 50 auth-service

# Shell inside a running container
docker compose exec auth-service sh

# Restart one service
docker compose restart auth-service

# Stop everything (containers removed, images kept)
docker compose down

# One-off command in a throwaway container, nothing else started
docker compose run --rm --no-deps auth-service npx prisma migrate status

# Disk reclaim
docker system df
docker builder prune
```

---

## 9. Gotchas already hit, and what is still missing

**Resolved along the way**

- `prisma generate` does **not** require `DATABASE_URL`. An earlier version passed
  a placeholder URL to satisfy an assumed requirement; it was removed after
  testing proved it unnecessary.
- `ARG SERVICE_NAME` placed too high broke shared-layer caching and caused
  parallel Prisma engine downloads to fail DNS resolution. Keep it low.
- A previous version ran `prisma generate` only for `auth-service`. That would
  have let any other service build cleanly and then crash at its first query with
  `@prisma/client did not initialize yet`. It now runs for every service.
- `npm install --legacy-peer-deps` once corrupted `package-lock.json`, after which
  `npm ci` failed inside Docker with `Missing: webpack@… from lock file`. Fixed by
  deleting the lockfile and reinstalling.
- Neon cold starts caused `P1001 Can't reach database server` on boot. Handled by
  the retry loop in `PrismaService.onModuleInit` plus `restart: unless-stopped`.

**Not yet addressed**

- **No `healthcheck:`** — `docker compose ps` reports "Up" for a process that
  started but cannot serve traffic. A healthcheck hitting each service's root
  route would make the status column meaningful.
- **No `depends_on:`** — needed once services call each other at startup.
- **Image size** — every image installs the full production dependency tree
  including Prisma, even for services that never query the database. Acceptable
  for now; revisit if build times become painful.
- **`NODE_ENV=production` is hardcoded** in the Dockerfile, so there is currently
  no development image with hot reload. Code changes require a rebuild.
- **One shared database schema** — all services read one `prisma/schema.prisma`.
  True microservice isolation would give each service its own database.

---

## 10. Related files

| File                   | Role                                                            |
| ---------------------- | --------------------------------------------------------------- |
| `Dockerfile`           | Build template for all nine service images                      |
| `docker-compose.yml`   | What to run, on which ports, with which environment             |
| `.dockerignore`        | What never enters the build context                             |
| Environment file       | Real credentials — gitignored, dockerignored, never in an image |
| `.env.example`         | The same keys with placeholder values, committed                |
| `nest-cli.json`        | The `projects` map that makes `nest build <service>` work       |
| `prisma/schema.prisma` | Database schema; `url = env("DATABASE_URL")`                    |
| `PROJECT_OVERVIEW.md`  | Wider project documentation beyond Docker                       |
