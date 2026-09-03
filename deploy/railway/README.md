# Railway: two isolated hosted environments

This is the deployment definition for DocAIFlow. It is intentionally two **environments**, not two processes on the same server: development data, credentials, queues, databases and PDF objects must never be shared with production.

| Environment | Railway project | Public hosts | R2 bucket | Services |
|---|---|---|---|---|
| Development | `docaiflow-development` | `app.dev.docaiflow.com`, `api.dev.docaiflow.com` | `docaiflow-dev-pdfs` | `web-dev`, `api-dev`, `worker-dev`, `PostgresDev`, `RedisDev` |
| Production | `docaiflow-production` | `app.docaiflow.com`, `api.docaiflow.com` | `docaiflow-prod-pdfs` | `web`, `api`, `worker`, `PostgresProd`, `RedisProd` |

Cloudflare remains the DNS/TLS provider and R2 is the private object store. Railway hosts only the SPA, API, worker and managed PostgreSQL/Redis. Never make either R2 bucket public: PDF bytes always stream through the API after its signed URL check.

`app.*` and `api.*` deliberately share the `docaiflow.com` site. The refresh cookie is `SameSite=Lax`; unrelated registrable domains would break browser sessions even if CORS were configured correctly.

## Create each environment

1. Create the Railway project and its managed PostgreSQL and Redis services using the names in the table. Do not use a Redis or database from the other project.
2. Create two Cloudflare R2 buckets and two R2 API tokens. Each token gets Object Read & Write permission for *only its own bucket*.
3. Create `api[-dev]`, `worker[-dev]` and `web[-dev]` services from the same repository and commit. Configure the Dockerfiles and commands below.
4. Add the Cloudflare DNS custom domains to the public API and web services. Confirm the exact CNAME target Railway displays; do not guess it or proxy it through Cloudflare before Railway has validated the domain.
5. Configure variables, run the migration service once, deploy worker before API, then run the smoke checks in [`docs/runbooks/production-deployment.md`](../../docs/runbooks/production-deployment.md).

Railway manages database credentials. Use reference variables exactly as shown in the templates rather than copying connection strings. Rotating a managed credential then updates the services that reference it.

## Service configuration

| Service | Dockerfile | Start command | Public | Health check |
|---|---|---|---|---|
| API | `Dockerfile.backend` | image default (`node dist/index.js`) | yes | `/health/ready`, 60 s |
| Worker | `Dockerfile.backend` | `node dist/worker.js` | no | none |
| Web | `Dockerfile.frontend` | image default | yes | `/healthz`, 30 s |
| Migration | `Dockerfile.migrations` | image default | no, one-shot | none |
| Backup | `Dockerfile.backend`, **target `backup`** | image default (`npm run backup`) | no, scheduled | none |

Set `RAILWAY_DOCKERFILE_PATH` per service. **Railway exposes service variables at Docker build time only when the Dockerfile declares an `ARG`**, and that sentence has already cost a day: `VITE_SENTRY_DSN` was set correctly on the web service and the SPA reported nothing, because `Dockerfile.frontend` declared no `ARG` for it (fixed in [`features/0041`](../../features/0041-sentry-reaches-the-spa.md)). The web service has **two** build variables, not one:

```text
# web-dev
VITE_API_URL=https://api.dev.docaiflow.com/api
VITE_SENTRY_DSN=

# web
VITE_API_URL=https://api.docaiflow.com/api
VITE_SENTRY_DSN=https://…ingest.<region>.sentry.io/…
```

Both are compiled in, so **changing either one requires a rebuild, not a restart**. Two checks confirm a rebuild actually happened, and neither needs platform access: the bundle filename in the served HTML must change, and the page's CSP `connect-src` must contain the Sentry ingest origin — it is derived from the DSN at build time, so a CSP without it means the build never saw the value.

Build the frontend separately in each project. Its API URL and CSP are compiled into the JavaScript, so moving an already-built web image between environments is unsafe. Disable Railway skipped builds for this service unless the build variables are guaranteed unchanged.

Paste `development-api-worker.env.example` or `production-api-worker.env.example` into the API and worker's Raw Editor. They enumerate every application runtime variable. API-only values on the worker are intentional: both processes receive the same configuration and the boot validator checks the shared security settings consistently.

The migration service needs only:

```text
DATABASE_URL=${{PostgresDev.DATABASE_URL}}
# or: DATABASE_URL=${{PostgresProd.DATABASE_URL}}
```

Run it manually before a release. Do not configure it as an always-on service, and never replace it with `prisma db push`. Railway pre-deploy commands run in the serving image, which deliberately excludes the Prisma CLI; the separate short-lived migration image preserves that security and size boundary.

## The scheduled backup

Its own service, for the same reason the migration job is: `Dockerfile.backend`'s `backup` target carries `postgresql-client-16`, and the image that serves customer traffic must not. Build it with the target set explicitly, or Railway gives you the serving image, which has no `pg_dump`.

**A mounted volume is not optional.** A scheduled job runs in a container that is discarded when it exits, so without one the job succeeds every night and keeps nothing. `npm run backup` refuses to start without `BACKUP_DIR` for exactly this reason.

```text
BACKUP_DIR=/backups
DATABASE_URL=${{PostgresProd.DATABASE_URL}}
PDF_STORAGE_DRIVER=s3
PDF_STORAGE_BUCKET=docaiflow-prod-pdfs
PDF_STORAGE_ENDPOINT=…
PDF_STORAGE_ACCESS_KEY_ID=…
PDF_STORAGE_SECRET_ACCESS_KEY=…
```

**The storage variables are the ones people leave out**, and leaving them out does not fail: the run exits `0` having copied **zero documents**, which is a database backup of a product whose forms restore with PDFs that are gone. The job prints the document count; read it.

Two things the platform owns and the repository cannot:

- **Notify on a non-zero exit.** Both halves already exit non-zero, into a void. Without a notification a backup that stops working is discovered at the restore.
- **Retention.** One directory per run, so pruning is deleting the oldest directory. Nothing prunes on its own; decide the number and record it in [the runbook](../../docs/runbooks/backup-and-restore.md).

A volume beside the database survives a discarded container, not the loss of the account. **This is not the off-site copy** — that remains a deliberate, documented act.

## Secrets and operational limits

- Generate `JWT_SECRET` independently per hosted environment with `openssl rand -base64 48`.
- Generate `WEBHOOK_SIGNING_KEY` independently with `openssl rand -base64 32`.
- Store those and R2 secrets in Railway variables, never in these templates, Git, Cloudflare Pages variables, browser code or build logs.
- `TRUST_PROXY_HOPS=1` is the initial Railway ingress assumption. Before admitting users, verify a controlled request reaches the API with its actual source address in rate-limit behaviour; change the value if Railway's live proxy chain differs.
- The private beta intentionally leaves all Stripe variables empty. Do not use Stripe test keys in production; live billing is a separate launch decision.
- Start with one API and one worker replica per environment. Production can scale the API after a backup/restore drill and load evidence; external R2 and Redis already make that technically safe.

## Local development

Copy `backend/.env.local.example` to `backend/.env` and `frontend/.env.local.example` to `frontend/.env.local`. These values use local PostgreSQL and no queue by default. To exercise the queue, run the repository's development Compose dependencies, set `REDIS_URL=redis://localhost:6379`, and run `npm run worker:dev --workspace=backend` in addition to `npm run dev`.

The local templates are deliberately not a cheap copy of hosted development: `NODE_ENV=development` permits the explicit local `DEV_PLAN_KEY`; hosted development uses `NODE_ENV=production`, real limits and its own persistent data so it catches release configuration errors.
