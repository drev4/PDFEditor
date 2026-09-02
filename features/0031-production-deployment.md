# 0031 — Production deployment packaging

**Status:** done

**Branch:** `feature/0031-production-deployment`

## Why

D1 in [`docs/sot/10-saas-roadmap.md`](../docs/sot/10-saas-roadmap.md) is the first blocker for the private beta: the product has an API, a background worker and a built SPA, but no production artifact that can run them. The related backlog rows also record two traps that packaging must close rather than carry into production: Prisma must generate its client before dev dependencies are removed, and `/health` currently reports success while PostgreSQL is unreachable.

The provider and the final app/API hostnames were external decisions when the package was first built. They are now part of this feature's final operational definition: Railway hosts the application services and managed data services; Cloudflare retains DNS/TLS and private R2 object storage; development and production are isolated projects.

## Why the obvious approach is wrong

- The development `docker-compose.yml` is not a production definition. It provisions stateful dependencies on local volumes and does not run the product.
- One container is not the application. With `REDIS_URL` set, the worker is required; an API-only deploy accepts saves while PDFs quietly fall behind.
- Running `prisma migrate deploy` in every API replica creates a release race. Migrations are a one-shot release job that must finish before API and worker start.
- A process being alive does not make it ready. Liveness must not restart an API just because PostgreSQL is temporarily down, while readiness must stop routing traffic to it.
- Frontend variables are Vite build-time inputs. Injecting `VITE_API_URL` only when the Nginx container starts cannot change already-built JavaScript or its CSP.

## Goal

1. Add a multi-stage backend Dockerfile that builds TypeScript, generates Prisma before pruning dev dependencies, and exposes separate runtime and migration targets.
2. Add a multi-stage frontend Dockerfile that requires the public API URL at build time and serves the SPA with history fallback and production security headers.
3. Add a production Compose definition for the migration job, API, worker and SPA. PostgreSQL, Redis and S3-compatible object storage are external inputs; no production data service is bundled.
4. Add a non-secret environment template and ensure the real deployment environment file is ignored.
5. Keep `GET /health` as a backwards-compatible liveness endpoint, add `GET /health/live`, and add `GET /health/ready` which checks PostgreSQL and, when Redis is configured, verifies at least one PDF worker is registered. It exposes queue counts without exposing credentials or exception text.
6. Add backend tests covering live, ready, database failure, Redis failure and configured-without-worker failure.
7. Add a release/rollback runbook with exact build, migration, smoke-check and rollback commands.
8. Define the hosted development and production environments, including provider boundaries, same-site hosts, service roles, secret boundaries and a complete variable template for local and hosted use.
9. Synchronise operations, roadmap and business planning with what is actually built. D1 remains open until the defined environments are actually provisioned and verified.

## Out of scope

- Provisioning provider accounts, domains, TLS certificates, PostgreSQL, Redis or object storage. This feature selects and documents them but cannot create third-party resources without credentials.
- Backups and restore drills (D3), error tracking (D4), or monitoring infrastructure beyond machine-readable readiness.
- Deploying, pushing images, changing DNS, configuring Stripe live mode or opening a pull request.
- Changing the SPA, authentication model, product behaviour or data model.

## Verification

```text
npm install
npm run test:backend
npm run build
npm run typecheck:tests --workspace=backend
docker compose -f compose.production.yml config
docker build --target runtime -f Dockerfile.backend .
docker build --build-arg VITE_API_URL=https://api.example.com/api -f Dockerfile.frontend .
```

The Docker builds may be reported as blocked when Docker is unavailable, but the Compose model, application tests and TypeScript builds must still pass.

## Outcome

Done on `feature/0031-production-deployment` in an isolated worktree because `feature/0030-account-data-export` had uncommitted work. The original checkout was not changed.

The portable package now has a pruned backend runtime image, a Prisma migration image, a separately built Nginx SPA image, a four-role production Compose model, a non-secret environment template and an operator runbook.

The deployment target is defined but not provisioned: Railway hosts the API, worker, SPA and managed PostgreSQL/Redis; Cloudflare provides DNS/TLS and two private R2 buckets. `deploy/railway/README.md` defines isolated `docaiflow-development` and `docaiflow-production` projects, their same-site hostnames, each service's image/command/health check, secret boundaries, and complete local/hosted environment templates. `Dockerfile.migrations` makes the one-shot Prisma job deployable without putting its CLI into the serving API image. No third-party account, DNS record, secret or customer data was created by this work.

Readiness is a real dependency signal. `/health` remains compatible, `/health/live` proves only that HTTP is alive, and `/health/ready` checks PostgreSQL plus Redis and a registered PDF worker when the queue is enabled. Ten focused tests cover the router and the dependency adapters.

The container smoke test caught one defect that unit tests could not: Nginx's `add_header` inheritance dropped every security header after the SPA fallback internally selected `index.html`. The child locations now carry the headers explicitly. The repeated smoke returned `200` for `/healthz` and a deep SPA route, with `frame-ancestors 'none'`, `DENY` and `nosniff` present.

Verified:

- Backend: 26 files, 300 tests passed.
- Frontend: 49 files, 405 tests passed.
- Backend and frontend production builds passed; backend test types passed.
- Compose configuration validated.
- Backend runtime image built and loaded both Prisma and RE2 after `npm prune --omit=dev`.
- Migration image built and reached Prisma's expected `P1001` against a deliberately unreachable loopback database, proving the CLI and schema were present without mutating data.
- API container returned liveness `200` and readiness `503` with the database deliberately down; the body exposed only `unavailable`.
- Nginx 1.30.4 image built and its configuration passed `nginx -t`.
- The hosted environment templates were checked against `KNOWN_VARIABLES`, and all non-test runtime variables are present in local, development and production templates.
- `Dockerfile.migrations` and the frontend image built successfully with the hosted development API URL; Compose validates against `.env.deploy.example`.

E2E and database-backed integration suites were not run: this change adds no user-visible flow, schema, constraint, transaction or data behaviour. The existing Playwright startup probe continues to use the backwards-compatible `/health` endpoint.

One pre-existing release risk became concrete in the image build and is filed in `docs/BACKLOG.md`: after dev dependencies are pruned, npm reports 15 production advisories (1 critical, 13 high, 1 moderate). The advisory detail could not be fetched in this session, so exploitability was not guessed and the risk was not described as resolved.
