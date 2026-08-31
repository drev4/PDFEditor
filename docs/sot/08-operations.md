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
| `JWT_ACCESS_TTL` | no | `15m` | Access-token lifetime. An access token cannot be revoked, so this is the window in which a stolen one still works. Session length is the refresh token below |
| `REFRESH_TOKEN_TTL_DAYS` | no | `7`, min `1` | How long a user stays signed in. Revocable, unlike the access token |
| `COOKIE_SECURE` | no | `true` | `Secure` on the refresh cookie. Browsers treat `localhost` as trustworthy, so the safe default also works in development. Set `false` only for a non-localhost deployment on plain HTTP, which should not exist |
| `RATE_LIMIT_REFRESH_MAX` | no | `60` | Session refreshes per window per IP |
| `RATE_LIMIT_REFRESH_WINDOW_MS` | no | `900000` (15 min) | |
| `PORT` | no | `3000` | |
| `NODE_ENV` | no | — | Sets Prisma's query logging (`services/db.ts`), and **gates `DEV_PLAN_KEY` below**. That gate is an allowlist, so an unset or unexpected value is the safe case |
| `FRONTEND_URL` | no | `http://localhost:5173` | The single allowed CORS origin |
| `BASE_URL` | no | `http://localhost:3000` | Prefix of returned PDF URLs. A wrong value produces PDF URLs that 404 in every environment except localhost |
| `UPLOAD_URL_TTL_SECONDS` | no | `900` (15 min), min `60` | How long a signed PDF URL stays valid. The link is a bearer capability, so longer is not free — see [07](./07-security-and-privacy.md) |
| `TRUST_PROXY_HOPS` | no | `0` | **Number of reverse proxies in front of this process.** See below — it decides whether rate limiting works |
| `RATE_LIMIT_LOGIN_MAX` | no | `10` | Failed logins per window per IP. Successful logins are refunded |
| `RATE_LIMIT_LOGIN_WINDOW_MS` | no | `900000` (15 min) | |
| `RATE_LIMIT_REGISTER_MAX` | no | `5` | Registrations per window per IP |
| `RATE_LIMIT_REGISTER_WINDOW_MS` | no | `3600000` (1 hour) | |
| `RATE_LIMIT_RESPONSES_MAX` | no | `20` | Public form submissions per window per IP |
| `RATE_LIMIT_RESPONSES_WINDOW_MS` | no | `600000` (10 min) | |
| `INVITATION_TTL_HOURS` | no | `72`, min `1` | How long an invitation link is valid. It is a bearer capability — there is no email service, so the inviter copies and sends it — which means anyone holding it can spend it until it expires |
| `RATE_LIMIT_INVITATION_MAX` | no | `20` | Invitation acceptances per window per IP |
| `RATE_LIMIT_INVITATION_WINDOW_MS` | no | `900000` (15 min) | |
| `DEV_PLAN_KEY` | no | unset | **Development only, and temporary.** Forces every organization onto one plan, ignoring `organizations.plan_key`. `dev` lifts every limit; `free`/`pro`/`team` pin everyone to that real plan, which is how the limit screens get driven deliberately. **Honoured only when `NODE_ENV` is `development` or `test`** — see below |
| `STRIPE_SECRET_KEY` | no | unset | Stripe's secret API key (`sk_test_…` / `sk_live_…`). Read by `services/stripe.ts` and by nothing else. **Unset means billing is simply off**: `POST /api/billing/checkout` and `/portal` answer `503` and the rest of the application is unaffected. The client is built lazily, so the process still boots without it |
| `STRIPE_WEBHOOK_SECRET` | no | unset | Signing secret for `POST /api/billing/webhook` (`whsec_…`). **The one to get right — see below** |
| `STRIPE_PRICE_PRO` | no | unset | The Stripe **price id** for Pro (`price_…`), never an amount. Unset ⇒ checkout answers `503`. Wrong ⇒ see below |
| `STRIPE_PRICE_TEAM` | no | unset | The Stripe **price id** for Team — a **per-seat** recurring price, so that a quantity means something. Independent of the one above: unset means Team is not for sale on this deployment and Free and Pro are unaffected. Wrong ⇒ the same deliberate fall to free described below |
| `ENABLE_HSTS` | no | `false` | Send `Strict-Transport-Security`. **Must stay off wherever the app is reachable over plain HTTP, including local development** — a browser that sees HSTS from `localhost` forces HTTPS on `localhost` for every port afterwards, and the breakage that follows never mentions this setting. Turn on where TLS terminates |

### `DEV_PLAN_KEY`, and the allowlist that makes it safe

Plan limits are real from [`features/0012`](../../features/0012-plan-catalogue-and-entitlements.md) onward, which makes the product harder to *build* — one published form on the free plan is not a workable development environment. `DEV_PLAN_KEY` is the escape hatch, and it is **meant to be deleted** once there are separate environments to run in. Removing it is a block at the bottom of `backend/src/services/plans.ts`, two call sites in `entitlements.ts`, and a line in `.env.example`.

The dangerous version of this feature is the one that reads `NODE_ENV !== 'production'`. That honours the override whenever `NODE_ENV` is unset, misspelled, or dropped by a process manager — every one of which is an ordinary way a real deployment ends up giving the product away with **no error anywhere**. So the check is an **allowlist**: the override applies when `NODE_ENV` is exactly `development` or `test`, and in every other case it is ignored and a `console.error` says so. The failure mode of a missing `NODE_ENV` is that limits are enforced.

Two consequences worth knowing:

- **It is visible.** The plan is named `Developer` and that name is rendered in the sidebar card and on the Settings screen. Seeing `Developer` where a customer would see `Free` is the signal that limits are off. The pseudo-plan is deliberately **not** a member of `PLANS`, so it cannot be sold to anyone.
- **The suites pin it off.** `backend/src/app.ts` calls `dotenv.config()` and every spec imports it, so a developer's local `DEV_PLAN_KEY=dev` reaches the tests — it did, and four of them failed. `vitest.config.ts`, `vitest.integration.config.ts` and `playwright.config.ts` all set `DEV_PLAN_KEY: ''`. Empty rather than absent, because dotenv fills in a key that is missing but leaves one that is already present. **The same three files pin the Stripe variables**, for the same reason and with a sharper edge: without those lines a developer's real `STRIPE_SECRET_KEY` would be the key the suites construct a client with. The two vitest configs pin them to fixed test values (the webhook secret is what lets the integration suite sign genuine events); Playwright pins them empty, so billing is off in the E2E run.

  **The E2E suite pins it to `team`, not to empty** ([`features/0015`](../../features/0015-team-plan-and-purchased-seats.md)). Seats are enforced now and Free covers one person — the owner — so on the free plan every invitation answers `402` and `e2e/team.spec.ts` could never reach the flow it tests. Seats are *bought*, and billing is deliberately off in that suite (the Stripe variables are pinned empty), so there is no way to buy any there. `team` rather than `dev` on purpose: that suite runs with limits **on**, as a paying customer with three seats, not with limits switched off.

### The four Stripe variables, and what breaks when each is wrong

All four are optional. With none of them set, billing is off, the billing routes answer `503`, and nothing else in the product changes — which is also how the test suites run ([`features/0013`](../../features/0013-stripe-subscriptions.md)). All of it works in Stripe **test mode**, which needs no company and no real card.

**`STRIPE_WEBHOOK_SECRET` is the one to spell out, because a wrong value fails in the worst possible way: silently, totally, and not on the path anyone is watching.** It is the HMAC key that proves a request to `POST /api/billing/webhook` came from Stripe. If it is wrong — a stale value, the dashboard's secret where the CLI's was needed, a copy-paste that lost a character — then *every* event fails verification and answers `400`. Nothing in this application logs an error, because a `400` is this API answering correctly ([04-backend-patterns §3](./04-backend-patterns.md)); nothing on any screen looks broken; and the symptom appears days later as **subscriptions that were paid for and never activated, and cancellations that never applied**. Stripe's dashboard is where the failure is visible, under the endpoint's delivery attempts, and it will eventually disable the endpoint for repeated failures. Note also that `stripe listen` prints a *different* secret from the one in the dashboard: use the CLI's locally and the dashboard's in a deployment.

**`STRIPE_SECRET_KEY` wrong or missing.** Missing is safe and explicit: `503` from both authenticated billing routes, and `503` from the webhook too, because a server that cannot verify a signature must not answer `200` to a forgery. A wrong key fails at Stripe's API with whatever Stripe says, which surfaces as a `500` — noisy, and therefore fine.

**`STRIPE_PRICE_PRO` or `STRIPE_PRICE_TEAM` wrong.** This one is worth understanding because the failure is *deliberate* and looks like a bug. If a subscription arrives on a price this deployment does not recognise, `planKeyForStatus` refuses to guess which tier was bought and resolves the organization to **free**, with a `console.error` naming both variables. The customer has paid and is on the free plan. That is the chosen direction — guessing "they paid for something, give them Pro" would make a configuration mistake invisible, and the only realistic way to reach it is this variable being wrong. Check the log before assuming the webhook is broken.

**Pin the API version on the webhook endpoint.** A webhook endpoint created for a deployment should set its API version explicitly; without one it inherits the *account* default, which someone can change in the dashboard without touching this repository. `services/stripe.ts` pins `2025-08-27.basil` for the calls it makes, and that is a different setting. When they diverge the application logs an error naming both and **still processes the event** ([04-backend-patterns §10a](./04-backend-patterns.md)) — so the symptom is a log line, not an outage, and the log line is the only warning that some field may now be read from the wrong place. Locally, `stripe listen --api-version 2025-08-27.basil` does the same job.

**The portal configuration is what makes seats and plan changes reachable at all** ([`features/0015`](../../features/0015-team-plan-and-purchased-seats.md)). Three switches, none of them in this repository, and the product does not work as designed without them:

- **Update quantities** — on. This is *how a customer buys a seat*. The application never pushes a quantity; `assertCanInvite` refuses the seat that was not bought, and the portal is the only place to buy one. With this off, a Team customer on their limit can never add anybody and the `402` is a dead end.
- **Switch plan**, with both products listed — on. There is deliberately no plan picker in this application: switching needs proration previews, confirmation and 3-D Secure, all of which the portal already does correctly. With this off there is no way to move between Pro and Team at all.
- **Manage downgrades: schedule at the period end**, not immediately. Same decision as cancellation below and as `planKeyForStatus`: the customer keeps what they paid for until the period ends. Set to immediate, the dashboard quietly contradicts the code.

**A Customer Portal configuration must exist, and it is not a variable.** `POST /api/billing/portal` calls `billingPortal.sessions.create`, and a Stripe account with no saved portal configuration answers `No configuration provided` — a `500`, not a `503`, because nothing in the application knows to expect it. It is **per account and per mode**, so configuring test mode does nothing for live. No test can catch this: the suites mock that call. Create it once in the dashboard (Settings → Billing → Customer portal → Save) or via the API. The test-mode account was configured on 2026-08-31 with cancellation `at_period_end` — which is not an arbitrary choice, it is the same decision as [04-backend-patterns §10a](./04-backend-patterns.md): a customer who cancels keeps what they paid for until the period ends, and the only mid-period drop to free is a payment that finally failed. Setting it to `immediately` in the dashboard would quietly contradict the code.

**`DEV_PLAN_KEY` must be empty when testing billing.** `effectivePlan` applies the override *before* it reads the stored plan, so the override wins over a real subscription — meaning billing will appear to work whether or not a single webhook arrived. That is precisely the false positive this whole feature is built to avoid.

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

**What the error handler logs, and why it is a subset.** `middleware/errorHandler.ts` logs a stack trace for 5xx and for any error that is not an `AppError`; it logs **nothing** for a 4xx. A 4xx is the API answering correctly — the client asked for something it may not have — and it is already reported in the response. This is not fastidiousness: opening the login page with no session calls `POST /api/auth/refresh`, which correctly answers `401 Not authenticated`, and that printed a stack trace on every anonymous page load. A log that cries fault when nothing is wrong is a log people stop reading, which is where the real fault will be. Once `pino` lands, 4xx belongs at `info` with a request id — a distinction the bare console cannot express.

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
6. **The SPA and the API must be same-site**, or nobody stays logged in. The refresh cookie is `SameSite=Lax`, so `app.example.com` calling `api.example.com` works (one registrable domain) and `app.example.com` calling an unrelated host does not. `SameSite=None` is **not** the fix: Safari and Firefox block third-party cookies, so it would work on the developer's Chrome and fail for real customers. Nothing in the code enforces this and development cannot reveal it — `localhost:5173` and `localhost:3000` are same-site, because ports do not affect same-site. Decide the domains before the first deploy. See [07-security-and-privacy](./07-security-and-privacy.md#what-the-session-model-does-not-cover).
7. **The host serving the SPA must send a `Content-Security-Policy` response header.** The application ships one in a `<meta>` element built by `frontend/vite.config.ts`, which covers `script-src`, `connect-src` and the rest — but a `<meta>` policy cannot express `frame-ancestors`, `report-uri` or `sandbox`, and browsers ignore those directives there. At minimum the host must add `frame-ancestors 'none'` (clickjacking) to the policy already in the page. See [07-security-and-privacy](./07-security-and-privacy.md#where-the-headers-actually-are).
