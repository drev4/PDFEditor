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

## The supported Node version

**Node `>=22.12.0`**, written in `.nvmrc` (22.12.0) and enforced three ways, because `engines` alone only warns:

| Guard | Catches |
|---|---|
| `engines` in the root `package.json` plus `engine-strict=true` in `.npmrc` | Installing on an unsupported Node — `npm ci` now **fails** instead of printing `EBADENGINE` and carrying on |
| `scripts/check-node.mjs`, wired to `pre*` hooks on every test/build/dev script | Switching Node *after* a good install, which is the common case and the one `engine-strict` cannot see |
| `node-version-file: .nvmrc` in every CI job | CI and developers drifting apart — CI used to pin `20.x` while `.nvmrc` said 22.12.0 |

`check-node.mjs` also asserts that `.nvmrc` satisfies `engines`, and with `--native` that the generated Prisma client and the `re2` binary both load. Run it directly with `npm run check:node`.

On an unsupported version the failures never mention Node: the frontend suite will not start (`ERR_REQUIRE_ESM`), the build dies with `crypto.hash is not a function`, and `re2` stops loading — which leaves the backend passing almost every test while silently not enforcing field patterns.

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

### `re2` is a native dependency

`backend` depends on `re2` (see [04-backend-patterns](./04-backend-patterns.md#8-code-like-input-is-compiled-in-one-audited-place)). Its install script downloads a prebuilt binary from GitHub and falls back to compiling with `node-gyp`, so a build toolchain is needed if that download is unavailable — `ubuntu-latest` in CI has one.

`re2@1.24.1` itself declares `engines: { node: ">=22" }`, which is **why this repository supports Node 22.12+ and nothing older** — adding it in [`features/0004`](../../features/0004-safe-author-supplied-regex.md) silently dropped Node 20, and `engines` went on claiming `^20.19.0 || >=22.12.0` until `engine-strict` caught it.

The binary is tied to a **Node ABI**: one built under Node 22 will not load under Node 20 and vice versa. `npm ci` builds the right one for whichever Node runs it. Locally, **after switching Node version run `npm rebuild re2`** — otherwise the engine fails to load. `npm run check:node` checks exactly this and says so.

If the module cannot load, the service still starts: `services/pattern-validator.ts` logs a loud error and treats every field `pattern` as no constraint. Safety is preserved — nothing falls back to a backtracking `RegExp` — but format validation is silently off, so treat that log line as an alert.

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

`.github/workflows/test.yml`, on push and PR to `main` and `develop`. Every job takes its Node version from **`.nvmrc`** via `node-version-file` — the version is written in exactly one place. A superseded run is cancelled (`concurrency` with `cancel-in-progress`).

- **`unit-tests`** — `npm ci`, `npm run check:node`, then **type check and build both workspaces** (`npm run build --workspace=frontend`, which runs `vue-tsc`, and `tsc --noEmit --project backend/tsconfig.json`), then the frontend and backend suites with coverage, uploaded to Codecov (`fail_ci_if_error: false`) and archived.
- **`integration-tests`** — `needs: unit-tests`. A `postgres:16` service, `npm ci`, **`prisma generate`**, `prisma migrate deploy`, `npm run test:integration --workspace=backend`. See [09-quality-and-testing.md](./09-quality-and-testing.md#backend-database-backed-tests).
- **`e2e-tests`** — `needs: unit-tests`. A `postgres:16` service, `npm ci`, **`prisma generate`**, cached Chromium, `prisma migrate deploy`, `npm run test:e2e`, Playwright report archived.

Both database jobs are gated on `unit-tests`, because neither can pass when the cheap suites are already failing, and both take minutes.

### `prisma generate` is not optional, and is not automatic

The generated client is not committed and is not part of the package tree. `@prisma/client` ships a `postinstall`, but in a workspaces monorepo it does not help by itself: it does `process.chdir(process.env.INIT_CWD)`, and `INIT_CWD` is where `npm` was invoked — the repo root — so it looks for `prisma/schema.prisma` there, does not find `backend/prisma/schema.prisma`, and **warns rather than failing**. Note also that `prisma migrate deploy` does *not* generate the client; only `migrate dev` does.

Left un-generated, `@prisma/client` is a stub that throws on construction. `backend/src/services/db.ts` constructs it at module scope, so the API dies at import — which is how a missing generate step presented as 34 unrelated E2E UI failures for twenty minutes.

Two guards, deliberately overlapping:

1. `backend/package.json` has `"postinstall": "prisma generate"`, so a fresh clone plus `npm ci` yields a working client.
2. Every CI job that touches the database also runs `npx prisma generate` explicitly, so a pipeline using `--ignore-scripts` still works and a reader of the workflow can see it happen.

**For a production build**, note that `prisma` is a devDependency: generate the client *before* pruning with `--omit=dev`, or the postinstall runs without its CLI.

### The E2E job waits for the API, not just the frontend

`playwright.config.ts` declares **two** `webServer` entries — the backend on `http://localhost:3000/health` and the frontend on `:5173` — both with `stdout`/`stderr` piped. Previously only the frontend was the readiness signal, so a backend that died at boot let the suite start anyway and fail 34 times with nothing in the log naming the cause. Now Playwright fails fast and the server's own output appears in the job log.

What CI still does not do:

| Gap | Why it matters |
|---|---|
| No lint | There is no ESLint configuration at all — see [09-quality-and-testing.md](./09-quality-and-testing.md) |
| Coverage is measured but not enforced | No threshold, and Codecov failures are ignored |
| Migrations are applied but never *tested* against existing data | The database jobs run `migrate deploy` against a fresh database, so a broken migration fails CI. Nothing exercises a migration against a database that already holds rows |
| No dependency or secret scanning | No Dependabot, no `npm audit` gate, no secret scan |

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
