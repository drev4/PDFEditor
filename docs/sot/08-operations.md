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
| `BASE_URL` | no | `http://localhost:3000` | Prefix of returned PDF URLs. A wrong value produces PDF URLs that 404 in every environment except localhost |
| `TRUST_PROXY_HOPS` | no | `0` | **Number of reverse proxies in front of this process.** See below — it decides whether rate limiting works |
| `RATE_LIMIT_LOGIN_MAX` | no | `10` | Failed logins per window per IP. Successful logins are refunded |
| `RATE_LIMIT_LOGIN_WINDOW_MS` | no | `900000` (15 min) | |
| `RATE_LIMIT_REGISTER_MAX` | no | `5` | Registrations per window per IP |
| `RATE_LIMIT_REGISTER_WINDOW_MS` | no | `3600000` (1 hour) | |
| `RATE_LIMIT_RESPONSES_MAX` | no | `20` | Public form submissions per window per IP |
| `RATE_LIMIT_RESPONSES_WINDOW_MS` | no | `600000` (10 min) | |

### `TRUST_PROXY_HOPS`, and why it is not a detail

The rate limiters in `middleware/rateLimit.ts` key on `req.ip`. What Express puts there depends entirely on `trust proxy`, which `app.ts` sets from this variable. Both wrong values fail, in opposite directions:

| Value | `req.ip` becomes | Result |
|---|---|---|
| Too low (e.g. `0` behind a load balancer) | The proxy's address | Every request looks like one client. The first attacker to trip a limit locks out **every** user — the limiter becomes an outage |
| `true` | The leftmost `X-Forwarded-For` value | The client picks its own identity and rotates it. **Every limiter silently stops working.** `express-rate-limit` rejects this value for exactly this reason, so do not reach for it |
| The real hop count | The client address | Correct |

The default is `0`, which trusts nothing: a deploy that forgets to set it degrades to a shared limit — visible and annoying — rather than to no limit at all. **Set it to the number of proxies actually in front of the process when you put one there**, and re-check it whenever the ingress path changes.

Verified behaviour, worth keeping true: with the default, rotating `X-Forwarded-For` does **not** bypass the limiter; with `TRUST_PROXY_HOPS=1`, each forwarded client gets its own budget.

**`frontend/.env`**

| Variable | Required | Default | Notes |
|---|---|---|---|
| `VITE_API_URL` | no | `http://localhost:3000/api` | Baked in at build time, so each environment needs its own build |

One gap remains: there is no startup validation of configuration beyond `JWT_SECRET`. Validating the whole environment with a Zod schema at boot — the same technique already used for request bodies — turns a class of production misconfiguration into a startup crash, which is where you want it. `config/env.ts` does the narrow version of this for integers: an unparseable value is logged and the safe default is used, never a permissive one.

## Database migrations

**A migration history exists**, baselined as step 0 of [`features/0001`](../../features/0001-stable-field-ids-and-safe-bulk-save.md). `backend/prisma/migrations/` holds:

| Migration | What it is |
|---|---|
| `0_baseline` | The whole schema as `db push` had built it, generated with `prisma migrate diff --from-empty` and marked applied with `prisma migrate resolve --applied 0_baseline`. It creates nothing new |
| `20260827232747_field_soft_delete_and_answer_field_index` | `fields.deleted_at` (nullable) and an index on `answers.field_id`. Purely additive |

**Every schema change from here uses `prisma migrate dev` locally and `prisma migrate deploy` everywhere else** (`npm run db:migrate` / `npm run db:migrate:deploy`). `db push` is for throwaway local databases only, and never against data anyone cares about — it diffs the schema against the live database and mutates it to match, with no record of intent, no ordering, no down path, and a willingness to drop a column that a deploy is halfway through reading.

**Baselining an existing database.** A database already built by `db push` has the tables but no `_prisma_migrations` row for them, so `migrate deploy` would try to create them and fail. Mark the baseline as already applied on that database once, and only then deploy:

```bash
cd backend
npx prisma migrate resolve --applied 0_baseline    # once, per pre-existing database
npx prisma migrate deploy
```

A fresh database needs none of that — `migrate deploy` applies both migrations in order.

The SaaS schema changes in [10-saas-roadmap.md](./10-saas-roadmap.md) — `Organization`, `Membership`, `Subscription`, and the `Form.userId` → `Form.organizationId` move — need *data* migration, not just structure. That is now expressible; it was not under `db push`.

## Continuous integration

`.github/workflows/test.yml`, on push and PR to `main` and `develop`, Node 20:

- **`unit-tests`** — `npm ci`, frontend tests with coverage, backend tests with coverage, upload to Codecov (`fail_ci_if_error: false`), archive coverage artifacts.
- **`integration-tests`** — a `postgres:16` service, `npm ci`, `prisma migrate deploy`, `npm run test:integration --workspace=backend`. The database-backed backend suite; see [09-quality-and-testing.md](./09-quality-and-testing.md#backend-database-backed-tests).
- **`e2e-tests`** — a `postgres:16` service, `npm ci`, install Chromium, `prisma migrate deploy`, `npm run test:e2e`, archive the Playwright report. The `RATE_LIMIT_*` variables are set high for it, in `playwright.config.ts` under `webServer.env` as well as in the workflow: every test registers its own user, and production limits would throttle the suite in a way that reads as a flaky test rather than a working limiter.

What CI does not do, and should:

| Gap | Why it matters |
|---|---|
| No type check | `vue-tsc` runs only inside `npm run build --workspace=frontend`, and the backend's `tsc` only in its build. CI never builds, so a type error reaches `develop` |
| No lint | There is no ESLint configuration at all — see [09-quality-and-testing.md](./09-quality-and-testing.md) |
| No build | Neither workspace is built in CI, so a broken production build is only discovered at deploy time |
| Coverage is measured but not enforced | No threshold, and Codecov failures are ignored |
| Migrations are applied but never *tested* | The `integration-tests` and `e2e-tests` jobs run `migrate deploy` against a fresh database, so a broken migration fails CI. Nothing exercises a migration against a database that already holds data |
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
2. **`migrate deploy` in the release pipeline**, with `migrate resolve --applied 0_baseline` run once against any database that predates the baseline.
3. **Per-environment frontend builds**, because `VITE_API_URL` is compile-time.
4. **Secrets from a secret manager**, never from a committed file. `JWT_SECRET` rotation invalidates every session, so rotation needs the refresh-token work from [07](./07-security-and-privacy.md) first.
5. **At least two API replicas behind a load balancer** — only possible after step 1.
