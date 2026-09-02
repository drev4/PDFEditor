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

Set `RAILWAY_DOCKERFILE_PATH` per service. Railway exposes service variables at Docker build time only when the Dockerfile declares an `ARG`; `Dockerfile.frontend` already declares `ARG VITE_API_URL`. Set the web service's sole application variable to the matching public API URL:

```text
# web-dev
VITE_API_URL=https://api.dev.docaiflow.com/api

# web
VITE_API_URL=https://api.docaiflow.com/api
```

Build the frontend separately in each project. Its API URL and CSP are compiled into the JavaScript, so moving an already-built web image between environments is unsafe. Disable Railway skipped builds for this service unless the build variables are guaranteed unchanged.

Paste `development-api-worker.env.example` or `production-api-worker.env.example` into the API and worker's Raw Editor. They enumerate every application runtime variable. API-only values on the worker are intentional: both processes receive the same configuration and the boot validator checks the shared security settings consistently.

The migration service needs only:

```text
DATABASE_URL=${{PostgresDev.DATABASE_URL}}
# or: DATABASE_URL=${{PostgresProd.DATABASE_URL}}
```

Run it manually before a release. Do not configure it as an always-on service, and never replace it with `prisma db push`. Railway pre-deploy commands run in the serving image, which deliberately excludes the Prisma CLI; the separate short-lived migration image preserves that security and size boundary.

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
