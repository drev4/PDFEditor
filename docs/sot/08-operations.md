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
| `DATABASE_URL` | yes | — | PostgreSQL connection string. [Validated at boot](#what-refuses-to-boot-and-what-only-warns) |
| `JWT_SECRET` | **yes** | — | The process refuses to start without it (`app.ts`), and [validated at boot](#what-refuses-to-boot-and-what-only-warns): at least 32 characters |
| `JWT_ACCESS_TTL` | no | `15m` | Access-token lifetime. An access token cannot be revoked, so this is the window in which a stolen one still works. Session length is the refresh token below |
| `REFRESH_TOKEN_TTL_DAYS` | no | `7`, min `1` | How long a user stays signed in. Revocable, unlike the access token |
| `COOKIE_SECURE` | no | `true` | `Secure` on the refresh cookie. Browsers treat `localhost` as trustworthy, so the safe default also works in development. Set `false` only for a non-localhost deployment on plain HTTP, which should not exist |
| `RATE_LIMIT_REFRESH_MAX` | no | `60` | Session refreshes per window per IP |
| `RATE_LIMIT_EXPORT_MAX` | no | `5` | Organization exports per window, counted **per user** rather than per address — the route is authenticated, so the address is the wrong identity to spend |
| `RATE_LIMIT_EXPORT_WINDOW_MS` | no | `3600000` (1 hour) | |
| `RATE_LIMIT_REFRESH_WINDOW_MS` | no | `900000` (15 min) | |
| `PORT` | no | `3000` | |
| `LOG_LEVEL` | no | `info` (`silent` under `NODE_ENV=test`) | `pino`'s level ([`features/0025`](../../features/0025-structured-logging.md)). `NODE_ENV=development` also switches the output to human-readable; anything else is one JSON object per line — see [Observability](#observability) |
| `NODE_ENV` | no | — | Sets Prisma's query logging (`services/db.ts`), and **gates `DEV_PLAN_KEY` below**. That gate is an allowlist, so an unset or unexpected value is the safe case |
| `FRONTEND_URL` | no | `http://localhost:5173` | The single allowed CORS origin |
| `REGISTRATION_MODE` | **in strict environments** | `open` | `open` or `invite_only`. Whether `POST /api/auth/register` accepts new accounts from anybody. [Validated at boot](#what-refuses-to-boot-and-what-only-warns), and see [closing and reopening sign-ups](#closing-and-reopening-sign-ups) |
| `REGISTRATION_CODE` | only when `invite_only` | — | The shared signup code, at least 16 characters. Never logged |
| `SENTRY_DSN` | no | — | Error tracking ([`features/0034`](../../features/0034-error-tracking-on-api-and-spa.md)). Unset means off. A malformed value [refuses to boot](#what-refuses-to-boot-and-what-only-warns), because the SDK would disable itself silently. See [Error tracking](#error-tracking) |
| `BASE_URL` | no | `http://localhost:3000` | Prefix of returned PDF URLs. A wrong value produces PDF URLs that 404 in every environment except localhost |
| `UPLOAD_URL_TTL_SECONDS` | no | `900` (15 min), min `60` | How long a signed PDF URL stays valid. The link is a bearer capability, so longer is not free — see [07](./07-security-and-privacy.md) |
| `PDF_STORAGE_DRIVER` | no | `local` | Where PDF bytes live: `local` (this process's disk) or `s3` (any S3-compatible store). **An unrecognised value refuses to boot** — see below |
| `PDF_STORAGE_BUCKET` | only when `s3` | — | Bucket name. The server will not start on the `s3` driver without it |
| `PDF_STORAGE_REGION` | no | `auto` | `auto` suits Cloudflare R2; AWS wants a real region |
| `PDF_STORAGE_ENDPOINT` | no | AWS default | R2's `https://<account>.r2.cloudflarestorage.com`, or `http://localhost:9000` for the MinIO in `docker-compose.yml` |
| `PDF_STORAGE_ACCESS_KEY_ID` / `PDF_STORAGE_SECRET_ACCESS_KEY` | no | unset | Leave both empty to use the SDK's own credential chain (instance roles, IRSA, `~/.aws/credentials`) |
| `PDF_STORAGE_FORCE_PATH_STYLE` | no | `false` | `true` for MinIO, which has no wildcard DNS so the bucket goes in the path |
| `PDF_STORAGE_PREFIX` | no | `pdfs/` | Key prefix, so a shared bucket stays legible and a lifecycle rule can target these objects |
| `WEBHOOK_SIGNING_KEY` | only for webhooks | unset | 32 bytes, base64. Encrypts endpoint secrets at rest (`webhook_endpoints.secret`). Unset means webhooks cannot be configured (`503`) and the worker says so at startup; everything else is unaffected |
| `WEBHOOK_JOB_ATTEMPTS` | no | `5` | Delivery attempts before a webhook is given up on |
| `WEBHOOK_BACKOFF_MS` | no | `10000` | First retry delay, doubling. Tens of seconds on purpose: an endpoint is usually down because somebody is deploying it |
| `WEBHOOK_WORKER_CONCURRENCY` | no | `3` | Deliveries in flight per worker. Lower than the embed's: each one holds a socket to somebody else's server for up to ten seconds |
| `REDIS_URL` | no | unset | **Drives three subsystems.** Unset means there is no job queue (the PDF embed runs inline, as it always has), rate limiting counts per process, **and webhooks cannot be configured at all**. Set, bulk save enqueues — so a worker must be running — the limiters count in one shared store, and webhooks become available. See the sections below |
| `REDIS_KEY_PREFIX` | no | `vuepdf` | Namespace for every key this application writes in Redis, so one Redis can be shared. Rate-limit keys are `<prefix>:rl:<limiter>:<client>` |
| `EMBED_WORKER_CONCURRENCY` | no | `5`, min `1` | Embed jobs one worker runs at once. Jobs for the same form never overlap regardless — that is a lock, not a consequence of this number |
| `EMBED_JOB_ATTEMPTS` | no | `5`, min `1` | Tries before an embed job is given up on, with exponential backoff. Exhausting them logs `EMBED GAVE UP` — see below |
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

### PDF storage, and the two ways to get the switch wrong

`services/pdf-storage.ts` is the only module that reads or writes PDF bytes, and `PDF_STORAGE_DRIVER` chooses where they go. Unset means `local`, which is what this repository has always done and what every test suite runs on — `npm test` needs no bucket and no network.

**Switching the driver does not move the files.** This is the mistake that loses customer documents, and it is silent: flip `PDF_STORAGE_DRIVER` to `s3` and the application starts looking in a bucket that does not contain anything uploaded before the switch. The forms keep their rows and their fields; the PDF behind them simply stops resolving. The order is:

1. Create the bucket, **private**. There is no step where a PDF should be publicly readable — the only route to one is this API's signed, expiring URL ([`features/0006`](../../features/0006-signed-expiring-urls-for-uploaded-pdfs.md)), and a public bucket hands every customer document to anyone who guesses a key.
2. Set the `PDF_STORAGE_*` variables for the target, but **do not** switch `PDF_STORAGE_DRIVER` yet.
3. `npm run storage:migrate -- --dry-run`, then `npm run storage:migrate`. It copies every PDF the database references, verifies each by reading it back, skips what is already there, and never deletes the local original. It exits non-zero if anything failed or any referenced file was already missing from disk — do not proceed on a non-clean run.
4. Switch `PDF_STORAGE_DRIVER=s3` and restart.
5. Keep the local files until the bucket has been read from in anger. They are the only other copy.

**An unrecognised driver name refuses to start**, and that is deliberate and different from how `DEV_PLAN_KEY`, `envInt` and `resolvePlan` treat bad input. Those degrade to a safe default because there is one. Here there is not: falling back to local disk would accept uploads and lose them at the next deploy, so a typo in this variable stops the process instead of quietly costing documents.

**Rolling back** is setting `PDF_STORAGE_DRIVER` back to `local` — but be clear about what that does *not* recover: anything uploaded while the `s3` driver was live is in the bucket and not on the disk, so those forms lose their PDFs on the way back. A rollback is only clean if nothing was uploaded in between.

For local work on the `s3` driver, `docker compose up -d minio createbuckets` brings up MinIO and creates a private `vuepdf-pdfs` bucket (console on `http://localhost:9001`, `minioadmin` / `minioadmin`). Nothing requires it — with the container stopped, the default driver is unaffected.

### The job queue and its worker, and the failure that makes no noise

`REDIS_URL` decides where the PDF embed runs ([`features/0017`](../../features/0017-job-queue-for-pdf-embedding.md)). Unset, it runs inline inside `POST /api/forms/:formId/fields/bulk`, which is what this application has always done and what every test suite runs on. Set, the request enqueues a job and **a worker process must be running to do the work**:

```bash
npm run worker --workspace=backend        # dist/worker.js, the same image as the API
npm run worker:dev --workspace=backend    # tsx watch, for development
docker compose up -d redis                # a local Redis; nothing else requires it
```

**With `REDIS_URL` set and no worker alive, nothing fails.** No request errors, no endpoint 5xxs, no user sees anything wrong — the queue simply fills up and every saved form's PDF quietly stops matching its fields. That is the failure mode to design monitoring around, and it is why the worker refuses to start without `REDIS_URL` rather than idling and looking healthy.

**Is a worker alive?** Three signals, in the order to check them:

1. Its log says `[worker] pdf-embed worker started, waiting for jobs` at startup and `[worker] pdf-embed worker stopped` on a clean shutdown. A process whose last line is the first one and which is no longer running died the hard way.
2. Each finished job logs `embed job <id> done (form <formId>)`. Silence while forms are being saved means nothing is consuming.
3. The queue depth itself: `embedQueueStatus()` in `services/embed-queue.ts` returns `waiting`, `active`, `delayed` and `failed`. A `waiting` count that only grows is a dead worker seen from the API's side. It is not exposed over HTTP yet — that belongs with the readiness endpoint in *Observability* below.

**`EMBED GAVE UP`.** A job that exhausts `EMBED_JOB_ATTEMPTS` logs that line and names the form. It means that form's stored PDF no longer matches its fields — the database is correct and is the record that matters, but anyone downloading the PDF itself gets a stale AcroForm. It is logged differently from an ordinary failure (`will retry`) precisely so it can be grepped for. What to do about one:

1. Find out why. The error is on the same line; a missing object in storage, expired credentials and a corrupt document all look different.
2. Fix the cause, then **re-trigger the embed by saving the form's fields again** — any bulk save queues a fresh job, and the job reads the current fields, so nothing has to be replayed. There is no admin re-run command, and that is the gap to close if this ever happens twice.
3. The user is not told any of this. The user-visible "your PDF is out of sync" signal is still unbuilt ([04-backend-patterns.md §5](./04-backend-patterns.md)).

**A Redis that is configured but unreachable does not break saving.** The enqueue is bounded — five seconds, and connection options that fail rather than queue for ever — and on failure the embed runs inline in the request instead, logging `Could not enqueue PDF embed for form …`. That line appearing repeatedly means the queue is effectively off and every embed is back on the request path: correct, slower, and not what the deployment was configured for.

**Rolling back to inline is an environment variable**: empty `REDIS_URL`, restart the API, stop the worker. Nothing needs migrating — a queued job is reconstructible, and any later save embeds from the current fields. Jobs still sitting in Redis at that moment are abandoned, so drain the queue first if it is deep.

**Deploying the worker.** It is the same build (`npm run build --workspace=backend`) with `node dist/worker.js` as the command, and it needs the same `DATABASE_URL`, the same PDF storage variables and the same `REDIS_URL` as the API. On `SIGTERM` it finishes the job it is running before exiting, so a rolling deploy does not abandon a half-written document — give it a termination grace period longer than one embed takes. Note that a **hard** kill (`SIGKILL`, an OOM) does not lose the job: BullMQ recovers it as stalled and another worker re-runs it, which is safe because the embed is idempotent.

### Rate limiting, and what a shared store changes

`REDIS_URL` also decides where the rate limiters count ([`features/0018`](../../features/0018-shared-rate-limit-store.md)). Unset: an in-memory counter per process, which is correct at one replica and is what every test suite runs on. Set: one counter for the whole service, which is the only version that means anything above one replica — an in-memory limit multiplies by replica count and resets on every deploy.

**Which store a process ended up with is in its log**, once, on the first limited request:

```
Rate limiting is counting in Redis (shared across every replica)
Rate limiting is counting in-memory (per process; correct at one replica, and the limit multiplies by replica count above that)
```

**More than one API replica means `REDIS_URL`.** It is also what closes the cross-replica embed race — see the queue section above — so the rule is one line: scaling out is not supported without Redis and a worker.

**A Redis outage rejects limited requests; it does not let them through.** `passOnStoreError` is `false`, deliberately and with the argument written down in [07-security](./07-security-and-privacy.md). In practice: while Redis is unreachable, login, registration, session refresh, invitation acceptance and public form submission answer `5xx` in about two seconds each, and everything else in the product keeps working. **The rollback is one step** — empty `REDIS_URL` and restart, which returns that process to per-instance limits rather than to none. Do not "fix" an outage by flipping `passOnStoreError`.

**Clearing one locked-out identity.** Counters now survive a restart, so bouncing the API no longer unlocks anybody — that used to be the accidental remedy and it is gone. There is no self-service unlock and no admin endpoint; the keys are plain and can be inspected and deleted directly:

```bash
# What is currently limited (the client part is an IP or an IPv6 subnet):
redis-cli --scan --pattern 'vuepdf:rl:*'
# Example key: vuepdf:rl:login:::1/56
# Clear one identity on one limiter:
redis-cli DEL 'vuepdf:rl:login:<client>'
# Clear everything for one limiter (use with care - it lifts the limit for all):
redis-cli --scan --pattern 'vuepdf:rl:login:*' | xargs -r redis-cli DEL
```

Substitute `REDIS_KEY_PREFIX` if it is not the default. A locked-out user is otherwise limited until the window expires: 15 minutes for login, refresh and invitations, an hour for registration, 10 minutes for submissions.

### Webhooks, and the one place the queue is not optional

`REDIS_URL` makes the PDF embed asynchronous; for webhooks it is a **requirement**, and `WEBHOOK_SIGNING_KEY` with it ([`features/0020`](../../features/0020-outbound-webhooks.md)). Without either, `POST /api/organizations/webhooks` answers `503` and says which one is missing — deliberately, rather than accepting a configuration that could never be delivered. That is the inverse of the queue's own known hole above, and the reason is that a feature whose entire purpose is to tell somebody something happened must never fail silently.

```bash
# 32 bytes, base64. Generating one:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Losing that key loses every endpoint's secret.** The secrets are encrypted with it and cannot be recovered without it; rotating it means every customer's receiver starts rejecting signatures until they are issued new secrets. Back it up with the same care as `JWT_SECRET`.

**The worker runs both job types.** `npm run worker` starts PDF embedding always and webhook delivery when the signing key is present; its startup line says which:

```
[worker] started, waiting for jobs (pdf-embed + webhook-delivery)
[worker] started, waiting for jobs (pdf-embed only)
```

**What failure looks like.** A delivery that failed and will be retried logs `webhook delivery … will retry`; one that has exhausted `WEBHOOK_JOB_ATTEMPTS` logs `WEBHOOK GAVE UP`, names the endpoint and the event, and says plainly that the customer was not told about it. After ten consecutive failures the endpoint is **disabled** — `disabled_at` and `last_error` on `webhook_endpoints`, both returned by the management API. **Nothing notifies the customer**, because this product has no email service; they find out by looking, and that gap is filed in [`docs/BACKLOG.md`](../BACKLOG.md).

An endpoint disabled with *"The endpoint URL is no longer deliverable"* is not a customer's server being down: it means the URL now resolves to an address inside the deployment, checked at delivery time as well as at configuration time. That is the DNS-rebinding defence firing, and the endpoint stays off until somebody looks at it.

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

### What refuses to boot, and what only warns

Configuration is checked once, at the boundary of a real process ([`features/0028`](../../features/0028-boot-time-configuration-validation.md)). `backend/src/config/validate-env.ts` owns it: `assertEnv('api')` runs in `src/index.ts` and `assertEnv('worker')` in `src/worker.ts`, both immediately after `dotenv.config()` and **before anything else is imported**. A problem is logged and the process exits `1`.

Three things about it are worth knowing before changing a variable or a rule.

**Every problem is reported, not the first.** A deployment missing four things learns all four from one restart; the alternative is discovering them one container start at a time.

**Strictness is an allowlist on `NODE_ENV`, and the ambiguous cases are strict.** Required variables are enforced unless `NODE_ENV` is *exactly* `development` or `test` — so a `NODE_ENV` that is unset, misspelled or dropped by a process manager gets the check, not a pass. It is the same argument, and literally the same constant (`OVERRIDE_ENVIRONMENTS`), that decides whether `DEV_PLAN_KEY` is honoured; note that the two point in opposite directions on purpose, because the safe answer is "enforce limits" there and "validate" here.

**Shape errors fire in every environment, including development.** A `PDF_STORAGE_DRIVER` nobody implements or a `WEBHOOK_SIGNING_KEY` of the wrong length are not missing values, they are values that cannot work, and a developer benefits from hearing about them as much as a deployment does.

| Refuses to boot | When |
|---|---|
| `JWT_SECRET` | Missing, or shorter than 32 characters (strict only) |
| `DATABASE_URL` | Missing (strict only), or a scheme that is not `postgresql`/`postgres` |
| `BASE_URL` | **API only.** Missing (strict only), not an absolute `http(s)` URL, or ending in `/` — which produces a double slash in every signed PDF link |
| `FRONTEND_URL` | **API only.** Missing (strict only), or not an absolute `http(s)` URL |
| `PDF_STORAGE_DRIVER` | Not `local` or `s3`; or `s3` with no `PDF_STORAGE_BUCKET` |
| `WEBHOOK_SIGNING_KEY` | Present but not exactly 32 bytes of base64 |
| `REDIS_URL` | Present but not a `redis:`/`rediss:` URL |
| `TRUST_PROXY_HOPS` | **API only.** Present but not a non-negative integer |
| `STRIPE_SECRET_KEY` | **API only.** Set without `STRIPE_WEBHOOK_SECRET`, or with neither price id |
| `REGISTRATION_MODE` | Missing (strict only), or not `open`/`invite_only` |
| `REGISTRATION_CODE` | Missing, or shorter than 16 characters, when `REGISTRATION_MODE=invite_only` |
| `SENTRY_DSN` | Present but not an `http(s)` URL. Optional — absence is fine and means tracking is off |

`REGISTRATION_MODE` is the newest entry and the only one whose *required* rule exists to protect a **default** rather than to catch a missing value ([`features/0033`](../../features/0033-close-public-registration.md)). `config/registration.ts` treats an unset mode as `open`, which is the right behaviour for a developer and the wrong one for a deployment running a private beta — so the two halves are a pair, and removing either leaves the other unsafe. Like `JWT_SECRET`, it is asked of the worker too, although the worker registers nobody: same image, same environment, same argument as the paragraph below.

`BASE_URL`, `FRONTEND_URL`, `TRUST_PROXY_HOPS` and the Stripe group are **not** asked of the worker, and that is deliberate rather than an omission: the worker mints no URLs (`services/pdf-embed.ts` parses `form.pdfUrl` with `pdfFilenameFrom`, it never builds one), serves no HTTP and never calls Stripe, so requiring them would fail a correct deployment. `JWT_SECRET` and `DATABASE_URL` *are* asked of both, even though nothing on the worker's path signs a token today — the two processes are one image reading one environment, and a rule that holds for one and not the other produces the worst outcome available: an environment that boots the worker and then fails the API, one deploy later.

**Everything else still warns and falls back**, and that contract has not changed. `config/env.ts` is the narrow version of this for tunables: an unparseable `EMBED_WORKER_CONCURRENCY` is logged and the safe default is used, never a permissive one, because a typo in a tunable must not take the service down. `validate-env.ts` lists every one of those in `KNOWN_VARIABLES` with a one-line reason for leaving it unchecked, and `backend/tests/config-coverage.spec.ts` fails when a variable is read anywhere in `src/` and named nowhere in that list — the same lint-rule-shaped spec as `tests/async-handler-coverage.spec.ts`, for the same reason: `npm run lint` lints nothing.

The worker's own `REDIS_URL` refusal stays where it was, in `worker.ts`, and the validator deliberately does not duplicate it. Two different messages for one condition is worse than one.

## Closing and reopening sign-ups

The private beta is invitation-only and public registration opens a week later ([`features/0033`](../../features/0033-close-public-registration.md)). **Both directions are one operator action, on purpose** — opening on the day was never going to be a code change, a PR and a deploy.

**To close sign-ups:**

```bash
REGISTRATION_MODE=invite_only
REGISTRATION_CODE=<at least 16 characters>   # generate: openssl rand -base64 24
```

Restart the API. **The worker needs no restart** — it registers nobody — but it *does* validate both variables at boot, so a worker restarted later with a half-finished environment refuses to start. Set them for both processes.

**To reopen:** set `REGISTRATION_MODE=open` and restart the API. `REGISTRATION_CODE` can be left in place; it is ignored in `open` mode, and a wrong code is not an error there.

Four things to know before you touch it:

- **The code is shared, not per person.** Anyone it is forwarded to can register. That was weighed and accepted because the beta is free — a forwarded code costs an unpaid account, not revenue. If a cohort ever needs per-person revocable admission, that is the org-less-invitation item in [`docs/BACKLOG.md`](../BACKLOG.md).
- **There is no way to rotate it without a restart**, and no screen that shows it. It lives only in the environment.
- **Existing members are unaffected in both directions.** Closing sign-ups does not touch anybody who already has an account, and `POST /api/organizations/invitations/accept` keeps working — a customer can still add colleagues while the front door is shut.
- **`REGISTRATION_MODE=invite_only` with no `REGISTRATION_CODE` refuses to boot**, rather than starting with a door nothing can open.

## Telling a complete export from a truncated one

`GET /api/organizations/export` streams, so its status code is committed at the first byte ([`features/0030`](../../features/0030-account-data-export.md)). A failure part way through cannot be reported as an error — the route destroys the socket, and what the customer is left holding is a partial file.

**The check is the last key in the document:**

```bash
tail -c 40 vuepdf-export-acme-2026-09-02.json
#   ],
#   "complete": true
# }
```

A file without `"complete": true` is short, however it arrived, and the answer is always to repeat the export — there is no way to resume one. A file *with* it reached the end of the writer, which is the only guarantee the format offers.

Two things this does not tell you. It says nothing about whether the export was rate limited (that is a `429` before any bytes, so there is no file at all), and it says nothing about a proxy truncating a response after the API finished writing — which the marker would also catch, and which is the reason it is checked on the saved file rather than trusted from the API's own logs.

## Orphaned PDFs

Deleting a form or an account removes its stored document ([`features/0029`](../../features/0029-account-deletion-and-real-erasure.md)), and `services/pdf-gc.ts` is the only module that may do it. **Removal happens after the database transaction commits and never throws**, so the failure mode is a document left behind rather than a deletion that half-happened. The line to look for is:

```
Could not remove stored PDF; it is now orphaned
```

It carries the `key`. What to do: confirm no form still references it — `SELECT id FROM forms WHERE pdf_url LIKE '%<key>%'` should return nothing — then delete the object from the bucket (or `uploads/pdfs/` under the `local` driver), together with its `<key>-backup.pdf` sibling if one exists. The ordering is deliberate and worth keeping when doing it by hand: the reversible failure is bytes left behind, and the unrecoverable one is bytes removed while a live form still points at them.

Note that this only covers documents whose form was deleted. Two other sources of orphans exist and are filed in [`docs/BACKLOG.md`](../BACKLOG.md): the editor's save path, which repoints a form at a new document without removing the old one, and any object written before this feature existed.

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

**Structured logging is built** ([`features/0025`](../../features/0025-structured-logging.md)). `pino`, one JSON object per line on **stdout** — every level, including errors: splitting severities across two streams is a console habit that forces a collector to re-merge one stream of events by timestamp. `services/logger.ts` is the only module that constructs a logger; inside a request, handlers use `req.log`, which carries that request's id. Plus a `/health` endpoint returning `{status, timestamp}`.

| | |
|---|---|
| `LOG_LEVEL` | The level. `info` by default; `silent` when `NODE_ENV=test`, so a suite's output is its own |
| `NODE_ENV=development` | Human-readable output through `pino-pretty`. Anything else is JSON, because a machine is reading it |
| `requestId` | A UUID on every line of a request, generated here — **never** taken from an inbound `x-request-id`, which is a value the caller controls. When one is present it is recorded, truncated to 128 characters, as `upstreamRequestId` on the completion line |
| `request completed` | One line per request: `method`, `route` (the matched pattern, not the URL), `status`, `durationMs`. `/health` is skipped, since a load balancer calls it for ever |

**What is never logged, and why redaction is not the answer.** No request body, ever — the most sensitive thing this API handles is answer values typed by members of the public, and they arrive keyed by field id, so their *paths are data* and no redaction list can cover them. `redact` is configured for `authorization`, `cookie`, `password`, `token` and `secret` as a **backstop against a future line that forgets**, not as the mechanism: a design that logs everything and then removes the known-bad paths fails open, and this one logs only what it names. `backend/tests/request-log.spec.ts` asserts the absence on the arguments handed to pino rather than on the bytes it writes, which is the stricter place — redaction would hide a secret that had still been collected.

**What the error handler logs.** `middleware/errorHandler.ts` logs 5xx and any non-`AppError` at `error` with the stack, and a 4xx at `info` with its status and message — no stack, because it is not a fault. A 4xx is the API answering correctly — the client asked for something it may not have — and it is already reported in the response. This is not fastidiousness: opening the login page with no session calls `POST /api/auth/refresh`, which correctly answers `401 Not authenticated`, and that printed a stack trace on every anonymous page load. A log that cries fault when nothing is wrong is a log people stop reading, which is where the real fault will be. That is what [`features/0025`](../../features/0025-structured-logging.md) settled: a 4xx is no longer dropped, it is one `info` line carrying the same request id as everything else that request did.

There is no log aggregation, no metrics and no alerting. The practical consequence is that the two best-effort PDF operations described in [04-backend-patterns.md](./04-backend-patterns.md) can fail permanently and silently, and nobody finds out until a customer opens a PDF and the fields are gone — **error tracking now reports the exception, but nothing wakes anybody up**.

Minimum viable observability, in order:

1. ~~**`pino` with a request id** on every log line, and redaction configured for `authorization`, `password` and answer values.~~ **Done** ([`features/0025`](../../features/0025-structured-logging.md)).
2. ~~**Error tracking** (Sentry or equivalent) on both the API and the SPA, so browser-side editor failures are visible at all.~~ **Done** ([`features/0034`](../../features/0034-error-tracking-on-api-and-spa.md)) — see [Error tracking](#error-tracking) below.
3. **Real health checks** — the current `/health` returns `ok` even when the database is unreachable. Split liveness from readiness, and have readiness check the database.
4. **Business metrics** — forms published, responses received, PDF embed failures. These are also the numbers that plan metering will need.

Two of these are now sharper than they were, because a second process exists. Readiness should answer for the queue as well as the database, and the "dead worker" case above has no signal at all today beyond reading logs — a queue depth that only grows is the metric to export first.

### Error tracking

Sentry, on both sides, and **off unless configured** ([`features/0034`](../../features/0034-error-tracking-on-api-and-spa.md)). `backend/src/services/error-tracking.ts` and `frontend/src/services/error-tracking.ts` are the only modules that import the SDK, the same boundary `services/stripe.ts` draws.

| | |
|---|---|
| `SENTRY_DSN` | Backend. Unset means error tracking is off — no init, no network, no throw. A **present but malformed** value refuses to boot (see below) |
| `VITE_SENTRY_DSN` | SPA. **Compile time**: it is baked into the bundle by `npm run build` and cannot be changed by restarting anything. It is also **public by design**, because it ships in that bundle — it is not a secret and must not be handled as one |

**What is sent is an allowlist, not a redaction list.** The message, the stack, the request id, the matched route, the status and the process — and nothing else. The mechanism is `defaultIntegrations: false` on both sides, so the SDK collects nothing on its own; `beforeSend` deletes `request`, `user`, `breadcrumbs`, `extra` and `contexts` as a **backstop against a future change that forgets**, exactly as pino's `redact` is a backstop rather than the mechanism. `extra` and `contexts` are on that list because of a gap found in review: when `captureException` is handed a value that is **not an `Error`** — which is what both `unhandledRejection` handlers pass straight through — Sentry's *core* serialises that value's own properties into `event.extra.__serialized__`, and core is not an integration, so `defaultIntegrations: false` does nothing about it. The reason a denylist cannot work here is the one this document already gives for the log: answer values arrive keyed by **field id**, so their paths are the customer's data and there is no fixed set of names to strip.

**No Session Replay, anywhere.** It is off because it is never switched on.

**The public respondent surface reports nothing at all.** The three routes marked `meta: { public: true }` in the SPA router — `/form/:shareId`, its confirmation page and `/invitations/:token` — are excluded, at the call site and again in `beforeSend`. That is a decision rather than an oversight: [`features/0032`](../../features/0032-respondent-notice-and-ip-collection.md) had just stopped storing a respondent's IP by default because collecting it for an unimplemented purpose was indefensible, and sending the same person's browser session to a third-party processor without touching the notice that feature wrote would walk it back silently. **The cost is real: a bug that only happens on the public form is still invisible.** Filed in [`docs/BACKLOG.md`](../BACKLOG.md).

**Nothing is sent from development or test**, decided by `isStrict` rather than by `NODE_ENV !== 'production'` — so an unset, misspelled or dropped `NODE_ENV` falls into the reporting branch rather than the silent one. Same allowlist, and the same constant, as `DEV_PLAN_KEY` and `REGISTRATION_MODE`.

**A 4xx is never reported.** `middleware/errorHandler.ts` reports on exactly the branch that logs at `error` — 5xx and non-`AppError` throws — for the reason that file already argues: a 4xx is the API answering correctly, and reporting it buries the real fault and spends the quota that would have caught it.

Two failure modes worth knowing, because both are silent by nature and both were closed deliberately:

- **A malformed `SENTRY_DSN` does not make the SDK complain.** It disables itself quietly, so the process boots, serves, and reports nothing. That was observed, not assumed. `validate-env.ts` now refuses to boot on it, the same treatment `WEBHOOK_SIGNING_KEY` gets.
- **The SPA's CSP is an allowlist**, so an ingest origin missing from `connect-src` means the browser refuses every event while the SDK reports success. The origin is therefore *derived from the DSN* in `frontend/src/services/sentry-dsn.ts` rather than configured separately, and a DSN that is not a URL **fails the build** rather than emitting a policy without it.

## Backups and recovery

**The tooling and the drill are built** ([`features/0037`](../../features/0037-backups-with-a-tested-restore.md)). The procedure, the secret inventory and the drill log are in [`docs/runbooks/backup-and-restore.md`](../runbooks/backup-and-restore.md); this section records what the design settled.

| | |
|---|---|
| `npm run backup:db --workspace=backend` | `pg_dump --format=custom` plus a `<dump>.manifest.json` beside it. **Both are the backup** — the manifest carries the checksum, the applied migration, a row count per table and the document keys the dumped rows point at, and without it nothing can be verified |
| `npm run backup:objects --workspace=backend` | The PDF documents, with the work list read **from the manifest** rather than from the live database, so the two artifacts refer to the same moment |
| `npm run restore:verify --workspace=backend` | The drill. Restores into a scratch database and then checks the result |
| `backend/src/services/backup.ts` | Every decision the three make, with no shelling out, so `tests/backup.spec.ts` can exercise them without a PostgreSQL binary, a bucket or a network |

**Four things about it are easy to get wrong.**

**There are two stores and they must be restored together.** `Form.pdfUrl` points out of PostgreSQL and into object storage, and since [`features/0029`](../../features/0029-account-deletion-and-real-erasure.md) deleting a form deletes its document too — so a database at one moment against a bucket at another gives forms that open and fail at the document, with nothing logged. **The restore order is bytes first, rows second**, which is the *mirror* of the deletion order rather than a copy of it: deletion removes rows first because the reversible failure is bytes left behind, and on restore that flips.

**`pg_restore` exiting `0` is not a verified restore**, which is why the drill is the deliverable and the backup script is not. It checks the migration against `prisma/migrations/`, the row counts against the manifest, foreign keys (via `--exit-on-error`, which validates constraints as it creates them — the flag is not optional), and **whether each restored `pdfUrl` resolves to bytes that are actually there**. That last check exists nowhere else in the codebase and is the one that catches a database backup taken without its objects.

**A dump is not enough to restore the product.** `WEBHOOK_SIGNING_KEY` encrypts `webhook_endpoints.secret` (`services/webhooks.ts`), so a restore under a fresh key leaves every customer's webhook secret unopenable with no rotation path. The runbook carries the full secret inventory.

**Redis is deliberately not backed up, and that does lose something.** The queues are reconstructible, so there is nothing to keep — but a restore drops the embed jobs in flight, and the failure is silent in the way [the queue section](#observability) describes: no errors, just forms whose PDF stops matching their fields. The runbook's post-restore step exists for that and must not be skipped.

**What is still open.** There is **no schedule** — nothing here runs on a clock, so the backup is a platform cron job and the RPO is whatever that is set to — and **nothing alerts** when a backup fails; both scripts exit non-zero into a void. Recovery time was measured on 2026-09-02 against a development dataset and the procedure passed, but **the production figure is unknown until there is a production database to measure**, and the runbook says to re-run the drill within a week of the first deploy.

Note also that `DELETE /api/forms/:id` cascades to every response with no soft delete and no undo. A misclick is unrecoverable even with backups in place, because nobody would know to restore.

## Deployment, when it is built

Requirements that follow from what is already in the code:

1. **Object storage first.** As long as PDFs live on the API process's disk ([02-architecture.md](./02-architecture.md)), the service cannot scale out and cannot survive a redeploy on ephemeral storage. This is the first blocker in the path. It is also a prerequisite for the queue: a worker in another container cannot read a file on the API container's local disk, so `PDF_STORAGE_DRIVER=s3` comes before `REDIS_URL` in any deployment that runs the two as separate processes.
2. **`migrate deploy` in the release pipeline**, with `migrate resolve --applied 0_baseline` run once against any database that predates the baseline.
3. **Per-environment frontend builds**, because `VITE_API_URL` is compile-time.
4. **Secrets from a secret manager**, never from a committed file. `JWT_SECRET` rotation invalidates every session, so rotation needs the refresh-token work from [07](./07-security-and-privacy.md) first.
5. **At least two API replicas behind a load balancer** — only possible after step 1.
6. **The SPA and the API must be same-site**, or nobody stays logged in. The refresh cookie is `SameSite=Lax`, so `app.example.com` calling `api.example.com` works (one registrable domain) and `app.example.com` calling an unrelated host does not. `SameSite=None` is **not** the fix: Safari and Firefox block third-party cookies, so it would work on the developer's Chrome and fail for real customers. Nothing in the code enforces this and development cannot reveal it — `localhost:5173` and `localhost:3000` are same-site, because ports do not affect same-site. Decide the domains before the first deploy. See [07-security-and-privacy](./07-security-and-privacy.md#what-the-session-model-does-not-cover).
7. **The host serving the SPA must send a `Content-Security-Policy` response header.** The application ships one in a `<meta>` element built by `frontend/vite.config.ts`, which covers `script-src`, `connect-src` and the rest — but a `<meta>` policy cannot express `frame-ancestors`, `report-uri` or `sandbox`, and browsers ignore those directives there. At minimum the host must add `frame-ancestors 'none'` (clickjacking) to the policy already in the page. See [07-security-and-privacy](./07-security-and-privacy.md#where-the-headers-actually-are).
