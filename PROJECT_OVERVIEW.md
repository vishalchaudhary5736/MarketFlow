# E-Commerce Backend — Project Overview

## 1. What this project is

A backend for an e-commerce platform, built as a set of independent services (microservices) instead of one single application. Each business area — auth, cart, catalog, inventory, orders, payments, notifications, analytics — runs as its own service, fronted by a single API gateway.

## 2. Architecture

```
                         ┌──────────────────┐
        client  ───────► │   api-gateway    │
                         └──────────────────┘
                                  │
        ┌───────────┬────────────┼────────────┬───────────┐
        ▼           ▼            ▼             ▼           ▼
   auth-service  cart-service  catalog-service  order-service  ...
                                  │
                                  ▼
                              ┌───────┐
                              │ Redis │  (cache)
                              └───────┘
```

- **api-gateway** — the single entry point clients talk to.
- **auth-service** — authentication/authorization.
- **cart-service** — shopping cart state.
- **catalog-service** — product catalog (currently the one service wired up to cache data in Redis).
- **inventory-service** — stock levels.
- **order-service** — order lifecycle.
- **payment-service** — payment processing.
- **notification-service** — emails/alerts.
- **analytics-service** — tracking/reporting.

Each service is a separate NestJS application with its own `main.ts`, module, controller, and service — it runs as its own process on its own port, so one service crashing doesn't take the others down.

## 3. Repo layout

```
apps/
  api-gateway/
    src/           → controller, service, module, main.ts (entry point)
    test/          → e2e tests
    tsconfig.app.json
  auth-service/    → same shape as above
  cart-service/
  catalog-service/   → also has CacheModule wired up (Redis)
  inventory-service/
  notification-service/
  order-service/
  payment-service/
  analytics-service/

nest-cli.json       → tells Nest CLI about all 9 apps (monorepo mode)
package.json         → one shared dependency tree for all services
package-lock.json     → locked dependency versions (must stay in sync with package.json — `npm ci` fails otherwise)
tsconfig.json         → shared TypeScript compiler config
tsconfig.build.json   → build-time overrides (excludes tests)
.env / .env.example   → per-service config, ports, and Redis connection details (see below)
Dockerfile             → builds any one service into a container image
docker-compose.yml     → runs all 9 services + Redis together
.dockerignore          → keeps secrets/build junk out of images
```

**Why one `package.json` for 9 apps?** It's a Nest monorepo: shared dependencies and tooling, but each app still compiles and runs as its own separate process. This is a common middle ground — not a true fully-independent microservice setup (that would mean separate repos/`package.json` per service), but it gives process isolation without the overhead of managing 9 separate dependency trees.

## 4. Environment configuration

- **`.env`** — real local values, gitignored, never committed. Loaded into each service via `import 'dotenv/config'` at the top of its `main.ts`.
- **`.env.example`** — committed template with the same variable names so anyone cloning the repo knows what to set (`cp .env.example .env`).
- **Per-service ports** — each service reads its *own* port variable (`AUTH_SERVICE_PORT`, `CART_SERVICE_PORT`, etc.) instead of a shared generic `PORT`, so all 9 can run at the same time without colliding.
- **Redis variables:**
  - `REDIS_HOST` / `REDIS_PORT` — where to reach Redis. Currently pointed at a managed Redis Cloud instance rather than the local `redis` container.
  - `REDIS_TTL` — default cache expiry in **milliseconds** (e.g. `180000` = 3 minutes) applied to any cached value that doesn't specify its own TTL.

## 5. TypeScript configuration

- `module`/`moduleResolution: "nodenext"` — modern, Node-accurate module resolution.
- `outDir: "./dist"` — compiled output location; each service's `tsconfig.app.json` narrows this further to `dist/apps/<service>`.
- Removed unused `baseUrl`/empty `paths` — there are no shared `libs/` or path aliases yet, so this was dead config. Can be reintroduced later if a shared `libs/` folder is added for cross-service DTOs/utils.
- Fixed all 9 generated e2e test files: switched `import * as request from 'supertest'` to `import request from 'supertest'`, since namespace imports aren't callable under `nodenext`'s stricter module rules.

## 6. Docker setup

- **`Dockerfile`** — one multi-stage build shared by all services:
  1. `base` — installs only `package.json`/`package-lock.json` first (for build caching).
  2. `dependencies` — installs full deps (incl. dev tools needed to compile).
  3. `build` — copies source in and runs `nest build <service>` for whichever service is being built (`ARG SERVICE_NAME`).
  4. `production` — fresh image, installs prod-only deps, copies in just the compiled `dist/` output. No TypeScript, no test files, no source in the final image.
- **`docker-compose.yml`** — defines all 9 app services plus a `redis` service, each app built from the same `Dockerfile` with a different `SERVICE_NAME` build arg, each getting its config from `.env` via `env_file`, each exposed on its own port, all sharing one Docker network (`ecommerce-net`) so they can reach each other by service name. `catalog-service` additionally has `depends_on: redis` and an `environment: REDIS_HOST: redis` override, since inside Docker it must reach Redis by container/service name, not `localhost`.
- **`.dockerignore`** — excludes `node_modules`, `dist`, `.git`, and `.env` from what gets copied into the image during build, so secrets and build artifacts never end up baked into an image layer. This only affects what goes *into the image*; `env_file` in `docker-compose.yml` is a separate, runtime-only mechanism that injects `.env` values into the running container — the two don't conflict.
- **`redis` service** — runs `redis:7-alpine`, with a named volume (`redis-data`) so cached data survives container restarts instead of being wiped every time the container is recreated.

## 7. Redis caching

Added to reduce repeated work for data that doesn't need to be fetched fresh every single request.

**Packages:** `@nestjs/cache-manager`, `cache-manager`, `keyv`, `@keyv/redis`.

**How the pieces fit together:**
```
your code → cache.get()/cache.set()   (Nest's CACHE_MANAGER token)
                    ↓
              cache-manager           (Nest's caching engine, storage-agnostic)
                    ↓
                 Keyv                 (generic key-value storage interface)
                    ↓
              @keyv/redis             (the Redis-specific adapter/implementation)
                    ↓
                 Redis
```
`cache-manager` doesn't know how to talk to Redis directly — it delegates to Keyv, which defines one common interface many different backends can implement (Redis, SQLite, Mongo, etc). This means swapping the storage backend later only touches the one `createKeyv(...)` line, not every place that calls `cache.get`/`cache.set`.

**Where it's wired up** — [apps/catalog-service/src/catalog-service.module.ts](apps/catalog-service/src/catalog-service.module.ts):
```ts
CacheModule.registerAsync({
  isGlobal: true,
  useFactory: () => ({
    stores: [createKeyv(`redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`)],
    ttl: Number(process.env.REDIS_TTL),
  }),
}),
```

**Where it's used** — [apps/catalog-service/src/catalog-service.service.ts](apps/catalog-service/src/catalog-service.service.ts), using the standard cache-aside pattern: check the cache first, and only compute/fetch and store the value if it wasn't already cached.
```ts
constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

async getHello(): Promise<string> {
  const cached = await this.cache.get<string>('hello');
  if (cached) return `${cached} (from cache)`;
  const value = 'Hello World!';
  await this.cache.set('hello', value);
  return value;
}
```

**TTL behavior:** the `ttl` set in `CacheModule.registerAsync` (from `REDIS_TTL`) is only a *default*. Passing a TTL directly to a specific `cache.set(key, value, ttl)` call overrides the default for that key — the more specific value always wins. This lets different cached items expire on different schedules (e.g. fast-changing cart data vs. slower-changing catalog data) without changing the global default.

**Verified working end-to-end:**
```
curl localhost:3003/  → "Hello World!"               (cache miss, value written to Redis)
curl localhost:3003/  → "Hello World! (from cache)"   (cache hit, served from Redis)
redis-cli KEYS '*'    → "hello"                        (confirmed the key exists in Redis)
```

**Currently only wired into `catalog-service`.** To add caching to another service, copy the same `CacheModule.registerAsync(...)` block into that service's module, inject `CACHE_MANAGER` where needed, and (if running via Docker) add the same `environment`/`depends_on` overrides for that service in `docker-compose.yml`.

## 8. How to run it

**Without Docker (local dev, one service at a time):**
```bash
npm install
npm run start:dev            # runs the default app (api-gateway)
nest start auth-service --watch   # run a specific service
```

**With Docker (all services + Redis at once):**
```bash
docker compose up --build     # build images + start all containers
docker compose up -d --build  # same, but detached (background)
docker compose logs -f        # tail logs
docker compose ps             # check which containers are running
docker compose down           # stop and remove everything
```

## 9. Build order so far (chronological)

1. Reviewed the initial Nest monorepo layout — confirmed it's a valid starting structure for a microservice-style backend, but noted missing pieces (no shared `libs/`, no per-service deployability, no Docker, no message broker yet).
2. Clarified that a single `package.json` doesn't mean a single running process — each app still runs as its own independent process/port.
3. Created `.env` and `.env.example`, gave each service its own port variable, wired `dotenv/config` into every `main.ts`.
4. Fixed a `tsconfig.json`-surfaced type error across all e2e test files (`supertest` import style) caused by the stricter `nodenext` module resolution.
5. Cleaned up unused `baseUrl`/`paths` from `tsconfig.json`.
6. Added Docker support: multi-stage `Dockerfile`, `docker-compose.yml` for all 9 services, and `.dockerignore` — built and test-ran `auth-service` end-to-end to confirm it works.
7. Added Redis: a `redis` container in `docker-compose.yml`, `REDIS_HOST`/`REDIS_PORT`/`REDIS_TTL` in `.env`, installed `@nestjs/cache-manager`/`cache-manager`/`keyv`/`@keyv/redis`, wired `CacheModule` into `catalog-service`, and updated `catalog-service.service.ts` to actually cache a value (cache-aside pattern). Hit and fixed an out-of-sync `package-lock.json` that broke `npm ci` inside the Docker build. Verified the full flow with real `curl` requests and `redis-cli`.
8. Switched `REDIS_HOST`/`REDIS_PORT` in `.env` to point at a managed Redis Cloud instance instead of the local `redis` container.

## 10. Not set up yet (future work)

- Redis Cloud credentials — the current connection string (`redis://${REDIS_HOST}:${REDIS_PORT}`) has no username/password. Redis Cloud instances typically require auth, so this likely needs `REDIS_USERNAME`/`REDIS_PASSWORD` added and the connection string updated before it will actually connect.
- Redis caching only covers `catalog-service` so far — not yet applied to other services.
- Inter-service communication/message broker (e.g. TCP, RabbitMQ, Kafka transports for Nest microservices, or Redis pub/sub).
- Database per service.
- Shared `libs/` folder for common DTOs/interfaces across services.
- CI/CD pipeline.
- Authentication/authorization flow details in `auth-service`.
