# Production deployment runbook

This runbook deploys the portable container package to the selected target. The two target definitions, exact service names and complete environment templates are in [`deploy/railway/README.md`](../../deploy/railway/README.md). It does **not** provision the Railway or Cloudflare accounts, DNS records, TLS validation, PostgreSQL, Redis or R2 buckets; those remain credentialed operator steps.

## Prerequisites

- A PostgreSQL database with TLS and credentials able to run migrations.
- Redis reachable by both API and worker.
- An S3-compatible private bucket reachable by both API and worker.
- Two same-site public hosts. The defined pairs are `app.dev.docaiflow.com` / `api.dev.docaiflow.com` and `app.docaiflow.com` / `api.docaiflow.com`; the refresh cookie does not work reliably across unrelated sites.
- Railway public services with custom domains validated through Cloudflare DNS.

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

## Railway release

For either Railway project, follow the service definition in
[`deploy/railway/README.md`](../../deploy/railway/README.md):

1. Build the short-lived `Dockerfile.migrations` service and run it once with that environment's `DATABASE_URL`. A non-zero migration exits the release; do not deploy around it.
2. Deploy or restart the worker from `Dockerfile.backend` with `node dist/worker.js` and confirm its log says it registered.
3. Deploy the API from `Dockerfile.backend`. Do not attach the public custom domain until `/health/ready` returns `200` and reports an `ok` database and registered queue worker.
4. Build the web service from `Dockerfile.frontend` in the same Railway project, with that project's `VITE_API_URL`. Attach its matching custom domain after `/healthz` returns `200`.

Do not use Railway's API pre-deploy command for Prisma while the API image remains pruned: the command would not contain the Prisma CLI. The separate migration image is intentional.

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

