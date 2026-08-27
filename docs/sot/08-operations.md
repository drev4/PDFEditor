# Operations

How the system is configured, built, tested and run — and, honestly, what is missing before it can be run for paying customers.

## Environments

| Environment | Status |
|---|---|
| Local development | Works. `docker-compose up -d` starts PostgreSQL 16, `npm run dev` starts both workspaces |
| CI | Works. GitHub Actions on push and PR to `main` and `develop` |
| Staging | **Does not exist** |
| Production | **Does not exist.** There is no deployment target, no Dockerfile for either app, no infrastructure definition |

`docker-compose.yml` provisions the database only. It is a development dependency, not a deployment artifact — do not mistake it for one.

## Configuration

Both workspaces ship a committed `.env.example`; the real `.env` files are gitignored and created by hand.

**`backend/.env`**

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | — | PostgreSQL connection string |
| `JWT_SECRET` | **yes** | — | The process refuses to start without it (`app.ts`) |
| `JWT_EXPIRES_IN` | no | `7d` | See the token-lifetime finding in [07](./07-security-and-privacy.md) |
| `PORT` | no | `3000` | |
| `NODE_ENV` | no | — | Read but not used to change behaviour anywhere |
| `FRONTEND_URL` | no | `http://localhost:5173` | The single allowed CORS origin |
| `BASE_URL` | no | `http://localhost:3000` | Prefix of returned PDF URLs. **Not in `.env.example`** — a wrong value here produces PDF URLs that 404 in every environment except localhost |

**`frontend/.env`**

| Variable | Required | Default | Notes |
|---|---|---|---|
| `VITE_API_URL` | no | `http://localhost:3000/api` | Baked in at build time, so each environment needs its own build |

Two gaps to close: `BASE_URL` belongs in `backend/.env.example`, and there is no startup validation of configuration beyond `JWT_SECRET`. Validating the whole environment with a Zod schema at boot — the same technique already used for request bodies — turns a class of production misconfiguration into a startup crash, which is where you want it.

## Database migrations

**There is no migration history.** `backend/prisma/migrations/` does not exist. The schema is applied with `prisma db push` in development (`npm run db:push`) and in CI.

This is a release blocker, and it is worth stating plainly why:

- `db push` diffs the schema against the live database and mutates it to match. It has no record of intent, no ordering, no down path, and it will happily drop a column that a deploy is halfway through reading.
- Without a migration history there is no `prisma migrate deploy`, which means there is no safe way to change the schema of a database containing customer data.
- Every schema change in [10-saas-roadmap.md](./10-saas-roadmap.md) — `Organization`, `Membership`, `Subscription`, and the `Form.userId` → `Form.organizationId` move — needs data migration, not just structure migration. That is not expressible in `db push` at all.

**The fix is to baseline before the first real deployment:** generate an initial migration from the current schema, commit it, and switch CI and every environment to `migrate deploy`. Keep `db push` for throwaway local databases only. This must happen *before* any schema work for the SaaS layer, not alongside it.

## Continuous integration

`.github/workflows/test.yml`, on push and PR to `main` and `develop`, Node 20:

- **`unit-tests`** — `npm ci`, frontend tests with coverage, backend tests with coverage, upload to Codecov (`fail_ci_if_error: false`), archive coverage artifacts.
- **`e2e-tests`** — a `postgres:16` service, `npm ci`, install Chromium, `npm run db:push`, `npm run test:e2e`, archive the Playwright report.

What CI does not do, and should:

| Gap | Why it matters |
|---|---|
| No type check | `vue-tsc` runs only inside `npm run build --workspace=frontend`, and the backend's `tsc` only in its build. CI never builds, so a type error reaches `develop` |
| No lint | There is no ESLint configuration at all — see [09-quality-and-testing.md](./09-quality-and-testing.md) |
| No build | Neither workspace is built in CI, so a broken production build is only discovered at deploy time |
| Coverage is measured but not enforced | No threshold, and Codecov failures are ignored |
| Migrations are never exercised | Because there are none; CI uses `db push` |
| No dependency or secret scanning | No Dependabot, no `npm audit` gate, no secret scan |

Adding type check, lint and build to the `unit-tests` job is a small change with a large return, and it should land before the CI pipeline grows any further.

## Observability

Currently: `console.log`, `console.warn` and `console.error` to stdout, plus a `/health` endpoint returning `{status, timestamp}`.

There is no request id, no structured output, no log aggregation, no metrics, no error tracking and no alerting. The practical consequence is that the two best-effort PDF operations described in [04-backend-patterns.md](./04-backend-patterns.md) can fail permanently and silently, and nobody finds out until a customer opens a PDF and the fields are gone.

Minimum viable observability, in order:

1. **`pino` with a request id** on every log line, and redaction configured for `authorization`, `password` and answer values.
2. **Error tracking** (Sentry or equivalent) on both the API and the SPA, so browser-side editor failures are visible at all.
3. **Real health checks** — the current `/health` returns `ok` even when the database is unreachable. Split liveness from readiness, and have readiness check the database.
4. **Business metrics** — forms published, responses received, PDF embed failures. These are also the numbers that plan metering will need.

## Backups and recovery

There are no backups, and nothing has been restored, so recovery time is unknown. Before the first paying customer: automated daily PostgreSQL backups with a tested restore, and versioned object storage for PDFs. An untested backup is an assumption, not a backup.

Note also that `DELETE /api/forms/:id` cascades to every response with no soft delete and no undo. A misclick is unrecoverable today even with backups in place, because nobody would know to restore.

## Deployment, when it is built

Requirements that follow from what is already in the code:

1. **Object storage first.** As long as PDFs live on the API process's disk ([02-architecture.md](./02-architecture.md)), the service cannot scale out and cannot survive a redeploy on ephemeral storage. This is the first blocker in the path.
2. **`migrate deploy` in the release pipeline**, once a baseline migration exists.
3. **Per-environment frontend builds**, because `VITE_API_URL` is compile-time.
4. **Secrets from a secret manager**, never from a committed file. `JWT_SECRET` rotation invalidates every session, so rotation needs the refresh-token work from [07](./07-security-and-privacy.md) first.
5. **At least two API replicas behind a load balancer** — only possible after step 1.
