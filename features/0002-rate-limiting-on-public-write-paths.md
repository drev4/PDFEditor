# 0002 — Rate limiting on the unauthenticated write paths

**Status:** done
**Priority:** P0 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md))
**Branch:** `feature/0002-rate-limiting-on-public-write-paths`
**Related:** [`07-security-and-privacy`](../docs/sot/07-security-and-privacy.md) (S2) · [`04-backend-patterns`](../docs/sot/04-backend-patterns.md) · [`08-operations`](../docs/sot/08-operations.md) · [`09-quality-and-testing`](../docs/sot/09-quality-and-testing.md)

## Context

Nothing in this service is rate limited. `backend/src/app.ts` mounts CORS, `express.json()`, a static handler and five routers, and no throttle of any kind. Finding S2 in [07-security-and-privacy](../docs/sot/07-security-and-privacy.md) is the whole of it: the unauthenticated surface is three entry points and none of them costs an attacker anything.

Two of them are named in the backlog:

- **`POST /api/auth/login`** (`backend/src/routes/auth.ts`) — unlimited attempts against passwords whose only policy is `z.string().min(6)`. There is no lockout, no delay, no counter. Credential stuffing against this endpoint is free.
- **`POST /api/responses`** (`backend/src/routes/responses.ts`) — writes a `Response` plus one `Answer` per field into any published form, from anyone, with no CAPTCHA and no throttle. It is a data-integrity problem for the form owner (their responses table is the product) and a cost problem for us.

A third belongs with them and is not in the backlog row: **`POST /api/auth/register`**, in the same file, is unauthenticated, creates a `User` per call, and runs `bcrypt.hash(password, 10)` on the request thread before doing so. Unbounded account creation is a spam problem; unbounded bcrypt at cost 10 is a CPU exhaustion problem against a single-threaded Node process. Including it is a deliberate widening of the backlog row, called out here rather than done silently.

This is a prerequisite for the public API in [10-saas-roadmap](../docs/sot/10-saas-roadmap.md), and it is the first question on every B2B security questionnaire.

## Why the obvious approach is wrong

Installing `express-rate-limit` and calling `app.use(rateLimit({ windowMs, max }))` is four lines and it is wrong in four separate ways, each of which is visible in this repo's code today.

### 1. `trust proxy` is not set, so `req.ip` is not the client

`backend/src/app.ts` never calls `app.set('trust proxy', …)`. Express defaults it to `false`, so `req.ip` is the socket peer address. The deployment target in [08-operations](../docs/sot/08-operations.md) is at least two API replicas behind a load balancer. Behind any proxy, every request arrives from the proxy's address, so a per-IP limiter sees one client making all the traffic: **the first attacker to trip the limit takes the whole service down for everyone.** A rate limiter that converts an attack into an outage is worse than no rate limiter.

The intuitive repair — `app.set('trust proxy', true)` — is the worse failure. It makes `req.ip` the leftmost value of `X-Forwarded-For`, a header the *client* sends. An attacker rotates it per request and the limiter never fires. Verify this against the installed version's documentation rather than trusting this paragraph, but recent `express-rate-limit` refuses that combination on purpose with a validation error rather than silently doing nothing.

The correct value is *the number of proxies actually in front of the app*, and it has to come from configuration because it differs per environment. **It must default to not trusting anything**, so a deploy that forgets to set it degrades to a shared limit (annoying, visible, safe) rather than to no limit at all (silent, invisible, useless).

### 2. The default 429 body breaks the frontend's error path

`frontend/src/services/api.ts` reads the body before it checks the status:

```ts
const data = await response.json()

if (!response.ok) {
  if (response.status === 401) { localStorage.removeItem('token') }
  throw new ApiError(response.status, data.error || 'Request failed', data.details)
}
```

`await response.json()` is unconditional. A 429 whose body is a plain string — which is what the library's default handler sends, and Express serves as `text/html` — makes `response.json()` throw a `SyntaxError`. That is not an `ApiError`, so it carries no status, `useAsyncAction` falls through to its generic `fallbackMessage`, and the user is told "Login failed" with no indication that they should wait. **The limiter must respond with JSON in this API's existing shape**, `{ error: string }`, so the message reaches the user through the path every other error already uses.

Do not fix this by reordering the reads in `api.ts`. That file is the shared client for every request in the app and changing its error sequencing is a separate change with its own blast radius; make the server speak the contract the client already expects.

### 3. Production thresholds hard-coded into a module break both test suites

The limiter would be a module-level constant on an `app` that the test suites import once and reuse:

- `backend/tests/auth.spec.ts` makes four `POST /api/auth/login` calls and four `POST /api/auth/register` calls against the same imported `app`.
- The E2E suite runs `npm run dev` (`playwright.config.ts` `webServer.command`), so the backend is in `NODE_ENV=development`, not `test`. Six spec files register and log in, and CI sets `retries: 2`.

A limiter with real production numbers baked in makes both of these fail intermittently, and the failure presents as a flaky test rather than as a limiter doing its job — which is the most expensive kind of wrong. **Every limit must come from configuration, with production-safe defaults**, and the E2E job must set generous values.

### 4. Per-IP is the right baseline, and per-account is not a free upgrade

A per-IP limit on login stops one host brute-forcing one account. It does not stop credential stuffing distributed across a botnet, and the instinct is to add a second limiter keyed on the submitted email.

Do not add one in this change. A per-account limiter, without an unlock path or a notification, hands any anonymous attacker a way to lock a named user out of their own account by spamming their address — trading a hard attack for an easy one. Account-level lockout is real work that belongs with the password policy and breach-check item (S10 in [07-security-and-privacy](../docs/sot/07-security-and-privacy.md)), where the notification and unlock flow can be designed with it.

### And one thing to write down rather than solve

The library's default store is in-memory and per-process. With more than one replica the effective limit is multiplied by the replica count, and every deploy resets the counters. That is acceptable at one replica, which is where the product is; it stops being acceptable at the same moment object storage lands and the service scales out ([08-operations](../docs/sot/08-operations.md)). A shared store needs Redis, which arrives with the job queue. **File it in the backlog with that dependency stated — do not pull Redis into this change.**

## Goal

1. `POST /api/auth/login`, `POST /api/auth/register` and `POST /api/responses` each reject with **`429`** once their configured limit is exceeded, and the response body is JSON of the form `{ error: string }`.
2. A `Retry-After` header is present on the 429.
3. Every window and limit is read from environment configuration, with defaults that are safe in production and documented in `backend/.env.example`.
4. `app.set('trust proxy', …)` is set from configuration and **defaults to trusting no proxy**. The chosen value is documented in [08-operations](../docs/sot/08-operations.md) alongside the other deployment configuration.
5. A successful login does not consume the login budget — the limit bites on failed attempts, so a legitimate user cannot lock themselves out by working normally. Register and responses count every request.
6. `GET /health` is never rate limited. (It is registered in `app.ts` before the routers, so mounting limiters on the routers already achieves this — assert it with a test rather than assuming it.)
7. Tests prove each limiter fires: a request past the limit returns 429 with a JSON body, and a request under it does not. The limits used by tests are set through configuration, not by reaching into the limiter.
8. `npm run test:backend`, `npm run test:integration` and `npm run test:e2e` all pass, with the E2E job configured so the limiter does not throttle it.
9. [07-security-and-privacy](../docs/sot/07-security-and-privacy.md) records S2 as resolved and describes what is actually enforced; [08-operations](../docs/sot/08-operations.md) documents the new configuration; the backlog row is removed.

## Out of scope

- **Author-supplied regex on `POST /api/responses`** (S3). It is the next backlog item and gets its own spec. Do not touch the validation loop in `routes/responses.ts`.
- **Signed URLs for `/uploads`** (S1) and `helmet`/CSP (S5). Both are separate backlog rows; a limiter is not a substitute for either.
- **Password policy, account lockout, breach check** (S10). See point 4 above.
- **A global fallback limiter on every route.** The authenticated editor legitimately bursts — a bulk field save, individual field updates, a PDF upload — and choosing a global number that does not break it needs traffic data the project does not have. File it, do not guess it.
- **A Redis-backed store.** See the note above; it depends on the queue work.
- **Reordering the reads in `frontend/src/services/api.ts`.** See point 2.
- **CAPTCHA on the public form.** A different mitigation with a UX cost, worth a decision of its own once there is evidence of abuse.

## Execution prompt

> **Step 1 — read before writing.** `backend/src/app.ts` (the middleware order, the `/health` route, and the absence of `trust proxy`), `backend/src/routes/auth.ts` (`registerSchema`, `loginSchema`, and both handlers), the top of `backend/src/routes/responses.ts` down to the `prisma.response.create`, `backend/src/middleware/auth.ts` and `formOwnership.ts` for how this project writes and applies middleware, `backend/src/middleware/errorHandler.ts` for the error body shape, `frontend/src/services/api.ts` for how the client reads an error, and `backend/tests/auth.spec.ts` for the test style. Read §2 of [04-backend-patterns](../docs/sot/04-backend-patterns.md): middleware lives in `middleware/` and is applied at the route, next to the handler it guards, not layered globally in `app.ts`.
>
> **Step 2 — install and pin.** Add `express-rate-limit` to `backend`. Check the installed version's own documentation for the `trust proxy` validation behaviour and the correct way to supply a custom handler; do not rely on this spec's description of the library. Record the version in the PR description.
>
> **Step 3 — configuration.** Add the limits and the proxy setting to the environment, following the existing `process.env` usage in `app.ts`. Suggested names, adjust if something fits the codebase better: `TRUST_PROXY_HOPS` (default `0`), `RATE_LIMIT_LOGIN_MAX`, `RATE_LIMIT_LOGIN_WINDOW_MS`, `RATE_LIMIT_REGISTER_MAX`, `RATE_LIMIT_REGISTER_WINDOW_MS`, `RATE_LIMIT_RESPONSES_MAX`, `RATE_LIMIT_RESPONSES_WINDOW_MS`. Every one gets a default in code and an entry in `backend/.env.example`. Pick defaults you can defend in the PR description — a human failing to log in a handful of times in a few minutes is normal, a hundred is not.
>
> Note `BASE_URL` is also missing from `backend/.env.example` (its own backlog row). Adding it here is a one-line courtesy; if you do, say so in the PR description rather than leaving it as an unexplained diff.
>
> **Step 4 — `trust proxy`.** In `backend/src/app.ts`, `app.set('trust proxy', <hops from config>)` before the routers. Default to `0`. Do **not** use `true`. Write a comment saying why the number matters, because the next person to deploy behind a new proxy layer needs to change it and will not otherwise know.
>
> **Step 5 — the limiters.** New file `backend/src/middleware/rateLimit.ts`, exporting one named limiter per protected path — for example `loginRateLimit`, `registerRateLimit`, `responseRateLimit`. All of them share a handler that sends `429` with `{ error: '…' }` JSON and a `Retry-After` header, and a message a user can act on ("Too many attempts. Try again in a few minutes."). The login limiter skips successful requests; the other two do not. Apply each one at its route in `routes/auth.ts` and `routes/responses.ts`, in the middleware position where `authenticate` sits on the authenticated routes — the guard must be visible when reading the handler.
>
> **Step 6 — tests.** In `backend/tests/rate-limit.spec.ts` (mocked Prisma, following the existing `backend/tests/` style): for each of the three endpoints, drive it past its configured limit and assert the last response is `429`, that `res.body.error` is a non-empty string, and that `Retry-After` is present; assert a request under the limit is not throttled; assert `GET /health` never is. Set the limits for the test through the same configuration path production uses — if that means the config is read at import time and the spec has to set `process.env` before importing `app`, that is a real constraint and the test should make it obvious rather than work around it by importing the limiter directly. Confirm the existing `backend/tests/auth.spec.ts` still passes; if it now trips a limiter, raise the test-environment limit rather than weakening the production default.
>
> **Step 7 — do not break E2E.** The Playwright `webServer` runs `npm run dev`, so the backend sees `NODE_ENV=development`. Set generous limits for the E2E job in `.github/workflows/test.yml` (and locally, if the suite needs it). Run `npm run test:e2e` and confirm it is green — this is the step most likely to reveal that a default is too tight.
>
> **Step 8 — verify.** `npm run test:backend`, `npm run test:integration`, `npm run test:frontend`, `npx tsc --noEmit` in `backend/`, `npm run build --workspace=frontend`, `npm run test:e2e`. Then by hand: start the app, fail a login past the limit, and confirm the browser shows the limiter's message rather than a generic failure — that is the check that point 2 of "why the obvious approach is wrong" was actually addressed, and it is not visible from a backend test.
>
> **Step 9 — document.** Run `sot-sync`. At minimum: [07-security-and-privacy](../docs/sot/07-security-and-privacy.md) — S2 resolved, the "Lockout / throttling" row of the auth table, and the trust-boundary diagram's "no throttle" annotations; [08-operations](../docs/sot/08-operations.md) — the new environment variables and the `trust proxy` requirement in the deployment section; [04-backend-patterns](../docs/sot/04-backend-patterns.md) — a short note that public write paths carry a named limiter, so the next public endpoint gets one; [06-api-reference](../docs/sot/06-api-reference.md) — the `429` response on the three endpoints, after re-reading the routes (`api-contract-guard`). Remove the rate-limiting row from [`docs/BACKLOG.md`](../docs/BACKLOG.md) and add rows for the deferred work named above: the shared Redis-backed store (depends on the queue), the global fallback limiter, and per-account lockout (with S10). Set this file to `**Status:** done`.

## Outcome

Delivered as specified, on `express-rate-limit@8.6.2`. Every claim in "why the obvious approach is wrong" was checked against the installed library's source rather than taken on trust — `limit` (not `max`), the default handler calls `res.send(message)` so an object becomes JSON, `Retry-After` follows `standardHeaders`, and `trust proxy: true` is actively rejected with `ERR_ERL_PERMISSIVE_TRUST_PROXY`.

- `backend/src/middleware/rateLimit.ts` — `loginRateLimit` (failed attempts only), `registerRateLimit`, `responseRateLimit`, each applied at its route where `authenticate` sits. Window fixed at startup, limit read per request so tests drive the real configuration path. No global limiter.
- `backend/src/config/env.ts` — a small `envInt` helper shared by `app.ts` and the limiters. An unparseable value logs and falls back to the safe default, never to a permissive one.
- `app.set('trust proxy', …)` from `TRUST_PROXY_HOPS`, defaulting to `false` rather than `0` so `express-rate-limit`'s own `X-Forwarded-For` misconfiguration warning still fires.
- `backend/tests/rate-limit.spec.ts` — 7 specs covering the 429 status, JSON body shape, `Retry-After`, the under-limit case, the successful-login refund, `/health` never being limited, and a bad env value falling back to the default.

Verified against a real server, not only in tests:

| Check | Result |
|---|---|
| 4th failed login (limit 3) | `429`, `application/json`, `{"error":"Too many failed login attempts…"}`, `Retry-After: 900` |
| Rotating `X-Forwarded-For`, `TRUST_PROXY_HOPS` unset | Still `429` — spoofing does not bypass |
| `TRUST_PROXY_HOPS=1` | Each forwarded client gets its own budget |
| 6 successful logins against a limit of 2 | All `200` — refunded, so normal use cannot self-lock |
| Draft-8 headers | `RateLimit`, `RateLimit-Policy` present; no legacy `X-RateLimit-*` |

Suites: 237 frontend, 70 mocked backend (up from 63), 14 database-backed, both type checks and the frontend build clean.

**E2E is not green, and was not green before this change.** An unmodified `develop` checkout fails 11 of 38 specs; with this change it fails 9, and the failing sets differ between runs. No failure anywhere in the run was a `429`. This is filed as its own P0 row — a suite in that state cannot gate anything.

Scope notes: `POST /api/auth/register` was included beyond the backlog row's wording, for the reason given in Context. `BASE_URL` was added to `.env.example` while documenting the new variables, closing its own P1 row. Deferred and filed: the shared Redis store, account-level lockout, and a global fallback limiter.
