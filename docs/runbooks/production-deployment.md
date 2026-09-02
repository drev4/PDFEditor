# Production deployment runbook

This runbook deploys the portable container package. It does **not** provision a provider, DNS, TLS, PostgreSQL, Redis or object storage; those are prerequisites.

## Prerequisites

- A PostgreSQL database with TLS and credentials able to run migrations.
- Redis reachable by both API and worker.
- An S3-compatible private bucket reachable by both API and worker.
- Two same-site public hosts, for example `app.example.com` and `api.example.com`. The refresh cookie does not work reliably across unrelated sites.
- An ingress that terminates TLS and routes those hosts to web port 8080 and API port 3000.

Copy `.env.deploy.example` to `.env.deploy`, replace every placeholder and generate secrets rather than inventing them:

```text
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 32   # WEBHOOK_SIGNING_KEY, only when outbound webhooks are enabled
```

Do not commit `.env.deploy`. `VITE_API_URL` is compiled into the SPA and its CSP; changing it requires rebuilding the web image. Everything else is runtime configuration.

## Release

Use an immutable tag such as the Git commit SHA:

```text
docker compose --env-file .env.deploy -f compose.production.yml config --quiet
docker compose --env-file .env.deploy -f compose.production.yml build
docker compose --env-file .env.deploy -f compose.production.yml up --force-recreate --abort-on-container-exit --exit-code-from migrate migrate
docker compose --env-file .env.deploy -f compose.production.yml up -d worker api web
```

On a managed platform, map the same lifecycle explicitly:

1. Build `Dockerfile.backend` target `runtime` once and run it twice: default command for API, `node dist/worker.js` for worker.
2. Run `Dockerfile.backend` target `migrations` once as the release command.
3. Build `Dockerfile.frontend` with `VITE_API_URL` and run it as the web service.
4. Do not route API traffic until `/health/ready` returns 200.

Never replace the migration job with `prisma db push`. A database predating the migration baseline needs the one-time `migrate resolve` procedure in [`08-operations.md`](../sot/08-operations.md#database-migrations).

## Smoke checks

```text
curl --fail https://api.example.com/health/live
curl --fail https://api.example.com/health/ready
curl --fail https://app.example.com/healthz
```

Read the readiness JSON. It must say `database.status: ok`, `queue.status: ok` and `queue.workers` must be at least 1. Then verify one real browser session: sign in, upload a disposable PDF, add a field, save it and download the result. That last check crosses cookie, CORS, object storage, Redis and worker boundaries that individual probes cannot.

Check startup logs for configuration refusal, repeated enqueue fallbacks, webhook failures and `EMBED GAVE UP`. Logs are JSON on stdout and must be retained by the platform.

## Rollback

1. Keep the previous API and web image tags available.
2. Set `IMAGE_TAG` to the previous immutable tag and redeploy `worker`, then `api`, then `web`.
3. Do **not** reverse migrations automatically. Prisma migrations in this repository are forward-only; verify the previous application version is compatible with the current schema before routing traffic to it.
4. Re-run all smoke checks. A 200 from liveness alone is insufficient.

If Redis is the incident, emptying `REDIS_URL` is an emergency single-replica fallback documented in operations: embedding becomes inline and rate limiting becomes per-process. Do not use that rollback with multiple API replicas. If object storage is the incident, switching to local storage loses access to objects uploaded while S3 was active and is not a clean rollback.

