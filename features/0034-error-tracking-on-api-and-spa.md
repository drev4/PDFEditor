# 0034 — Error tracking on the API and the SPA

**Status:** done
**Priority:** P1 — dated by association. It is item 2 of the observability list in [08-operations](../docs/sot/08-operations.md#observability), and the private beta on **2026-09-30** is the thing it exists to serve: a beta whose purpose is learning what breaks cannot see half of what breaks
**Branch:** `feature/0034-error-tracking-on-api-and-spa`
**Related:** [08-operations §Observability](../docs/sot/08-operations.md#observability), [07-security-and-privacy](../docs/sot/07-security-and-privacy.md), [05-frontend-patterns](../docs/sot/05-frontend-patterns.md), [10-saas-roadmap §D4](../docs/sot/10-saas-roadmap.md#d--the-beta-on-2026-09-30), [`features/0025`](0025-structured-logging.md), [`features/0007`](0007-security-headers-and-csp.md), [`features/0032`](0032-respondent-notice-and-ip-collection.md)

## Context

The backend logs well: `pino`, one JSON object per line, a request id on every line inside a request ([`features/0025`](0025-structured-logging.md)). **The browser has nothing.** An exception in the field editor, a failed PDF render, a public form that throws while a respondent is filling it in — none of them produces a record anywhere. Today the only way anyone finds out is a customer describing it.

This is the last engineering row of the dated D track. D1 is in flight on `feature/0031-production-deployment`, D3 (backups) genuinely waits on it, and C1/C3 are business decisions. D4's own dependency was met by 0025.

**Reading the code found that the dependency is met only halfway, and this is the part a ticket could not carry.** The backlog row says *"every server-side line now carries a request id, so a tracked exception can be tied to the request that caused it."* The first half is true and the second does not follow. `backend/src/middleware/requestLog.ts:47-49` generates the id and attaches it to `req.log` — and **nothing ever sends it to the client**. There is no `res.setHeader` for it anywhere in the file, and `backend/src/app.ts:75-78` configures `cors()` with `origin` and `credentials` and **no `exposedHeaders`**, so the SPA — which is a different origin — could not read the header even if one were set. `ApiError` (`frontend/src/services/api.ts:33`) has nowhere to put it either.

So the correlation that is the *stated value* of this row does not exist yet, and building only the two SDKs would produce two piles of events that cannot be joined. Closing that link is part of this feature.

## Why the obvious approach is wrong

**1. `Sentry.init({ dsn })` with defaults contradicts a decision this repository has already made in writing.** [08-operations](../docs/sot/08-operations.md#observability) states it plainly: *"No request body, ever — the most sensitive thing this API handles is answer values typed by members of the public, and they arrive keyed by field id, so their paths are data and no redaction list can cover them."* The default SDK configuration attaches request data, and on the browser side records breadcrumbs for every fetch URL and console call. **A redaction list cannot fix this here for exactly the reason that paragraph gives** — the sensitive keys are field ids, which differ per form. The scrubbing has to be an allowlist of what may be sent, not a denylist of what may not, and that is the same "fails open versus fails closed" argument `0025` already won.

**2. Do not initialise tracking on the public respondent surface without deciding it explicitly.** The SPA serves the author's app *and* the respondent's form from one bundle. The router already marks the difference — `meta: { public: true }` on `/form/:shareId`, `/form/:shareId/confirmation` and `/invitations/:token` (`frontend/src/router/index.ts:76-91`). A respondent is not the customer: [`features/0032`](0032-respondent-notice-and-ip-collection.md) had just decided to *stop* collecting their IP by default because the collection had no implemented purpose, and shipping their browser session to a third-party processor a fortnight later — without touching the notice that feature wrote — would walk that back silently. **Session Replay must not be enabled at all**, on any route.

**3. The CDN loader script is blocked, silently.** The SPA's CSP is `script-src 'self'` (`frontend/vite.config.ts:35`). A Sentry loader `<script src>` is refused by the browser and nothing in the application errors. Install the SDK from npm so it is bundled.

**4. The ingest origin must be added to `connect-src`** (`frontend/vite.config.ts:61`, currently `'self'`, the API origin, `blob:`). Without it every event is dropped by the CSP, the SDK reports success, and the deployment looks instrumented while recording nothing — the precise silent-failure shape this repository keeps refusing (`PDF_STORAGE_DRIVER`, `WEBHOOK_SIGNING_KEY`, the dead-worker case).

**5. `VITE_*` is compile time, not run time.** `frontend/vite.config.ts` reads it at build, so the SPA's DSN is baked into the bundle and **cannot be changed by restarting anything** — unlike every backend variable. Two consequences to write down rather than rediscover: the frontend DSN is a build input, and it is **public by design** because it ships in the bundle. It is not a secret and must not be handled as one; the backend DSN is a different value and stays server-side.

**6. Off in development and test, and by an allowlist on `NODE_ENV`.** `NODE_ENV !== 'production'` sends events whenever `NODE_ENV` is unset, misspelled or dropped — here that means a developer's crashes landing in the customer project. Reuse `isStrict` (`backend/src/config/validate-env.ts:73`), which is built on `OVERRIDE_ENVIRONMENTS` — exported from `backend/src/services/plans.ts` and already shared by `DEV_PLAN_KEY` and `REGISTRATION_MODE`. Import it; do not write a third copy of the list.

**7. An unset DSN means off, and must not throw.** The Stripe precedent: all four variables optional, unset means the feature is simply not configured. Do **not** make the DSN required at boot — a deployment without error tracking is a deployment with less visibility, not a broken one.

**8. Do not report 4xx.** `backend/src/middleware/errorHandler.ts:57-61` deliberately logs a 4xx at `info` with no stack, and the comment there explains why at length: a 4xx is the API answering correctly, and a log that cries fault when nothing is wrong is a log people stop reading. Sending them to an error tracker recreates that exact problem in a new place, where it also costs quota. Capture 5xx and non-`AppError` throws only.

## Goal

1. `backend/src/services/error-tracking.ts` is the only module in the backend that imports the tracking SDK, mirroring `services/stripe.ts` and `services/embed-queue.ts`.
2. With the DSN unset, both processes and the SPA behave exactly as today — no init, no network call, no throw, and every existing test passes untouched.
3. The backend reports 5xx and non-`AppError` exceptions from `errorHandler`, each carrying its `requestId`. **No 4xx is reported**, asserted by a test.
4. No request body, no query string, no header other than an explicit allowlist, and no answer value reaches the tracker — from either side. Asserted by a test against the payload the SDK is handed, the way `backend/tests/request-log.spec.ts` asserts on pino's arguments rather than on bytes.
5. `installProcessGuards` (`backend/src/process-guards.ts`) reports uncaught exceptions and unhandled rejections before it does what it already does. The worker is covered as well as the API.
6. The SPA reports uncaught errors and unhandled rejections via `app.config.errorHandler`, and **no Session Replay is enabled anywhere**.
7. **Nothing is captured on a route whose `meta.public` is true.** Asserted by a test.
8. `X-Request-Id` is set on every API response, and named in the `cors()` `exposedHeaders`, so the SPA can read it cross-origin. It is always the id generated in `requestLog.ts`, **never** the caller-supplied inbound `x-request-id` — that value is already treated as untrusted there and only recorded as `upstreamRequestId`.
9. `ApiError` carries the `requestId` when the response had one, and an SPA error report includes it — so a browser event and a server log line can be joined. This is the acceptance criterion that makes the feature worth building; without it the two halves cannot be tied together.
10. Events are not sent when `NODE_ENV` is `development` or `test`, decided by the shared allowlist.
11. `SENTRY_DSN` and `VITE_SENTRY_DSN` are in `KNOWN_VARIABLES` so `backend/tests/config-coverage.spec.ts` passes, and both are documented in [08-operations](../docs/sot/08-operations.md) with the compile-time caveat from point 5 stated.
12. The CSP names the ingest origin, and `npm run build --workspace=frontend` produces a policy containing it. A test over `buildCsp` is the cheap way to hold this.

## Out of scope

- **CSP violation reporting** (P1, S9). It looks adjacent and is a separate problem with a trap in it: this app delivers its policy as a `<meta http-equiv>` tag (`frontend/vite.config.ts:75-89`), and **`report-uri`/`report-to` are ignored in a meta-delivered CSP** — so that item needs the policy moved to a real response header first, which is a change to how the SPA is served and belongs with D1. Leave the row, and add that finding to it.
- **Business metrics** and **alerting** — items 4 and beyond of the observability list. Error tracking with no alerting is still worth having; a dashboard somebody opens is the beta's actual workflow.
- **Real health checks** — item 3, being built on `feature/0031-production-deployment` as `backend/src/routes/health.ts` and `services/readiness.ts`. Do not touch either.
- **Log aggregation.** stdout stays stdout.
- **Choosing the vendor is not in scope as a *decision*** — the SoT says "Sentry or equivalent" and this spec assumes Sentry because it is the one with a maintained Vue 3 and Express SDK. What *is* in scope is confining it to one module per side, so replacing it is a contained change.
- **Anything owned by `feature/0031-production-deployment`:** `Dockerfile.*`, `compose.production.yml`, `deploy/**`, `backend/.env.local.example`, `frontend/.env.local.example`, `docs/runbooks/**`, `backend/src/routes/health.ts`, `backend/src/services/readiness.ts`. The two DSN variables must reach those templates; record it as a follow-up owed after 0031 merges, exactly as [`features/0033`](0033-close-public-registration.md) did, rather than editing them here.

## Execution prompt

> Read first: `backend/src/middleware/requestLog.ts` (the id is generated at `:47` and never leaves the process), `backend/src/app.ts:75-78` (the `cors()` call with no `exposedHeaders`), `backend/src/middleware/errorHandler.ts` (the 4xx/5xx split and why it exists), `backend/src/process-guards.ts`, `backend/src/config/validate-env.ts` (`isStrict`, `KNOWN_VARIABLES`), `backend/src/services/stripe.ts` (the model for an optional, single-module integration), `frontend/vite.config.ts:30-72` (the CSP), `frontend/src/main.ts`, `frontend/src/services/api.ts` (`ApiError` at `:33`), and `frontend/src/router/index.ts:76-91` (`meta.public`).
>
> Apply `backend-endpoint-pattern` only where a route changes — mostly this is middleware and services — and `frontend-state-pattern` for the SPA module. **No schema change:** do not open `prisma/schema.prisma`.
>
> **Write the failing tests first**, run them against the unchanged code, and confirm they fail before implementing. The three that matter: a 4xx does not reach the tracker while a 5xx does; the payload handed to the SDK contains no request body, query string or answer value; and `X-Request-Id` is present on a response and readable per the CORS configuration.
>
> **Build, in this order:**
> 1. **Close the correlation gap first, because it is independently useful and the smallest piece.** In `requestLog.ts`, set `res.setHeader('X-Request-Id', requestId)` immediately after the id is generated — before the `IGNORED` early return, so even a skipped path carries it. In `app.ts`, add `exposedHeaders: ['X-Request-Id']` to the `cors()` options. In `frontend/src/services/api.ts`, read the header and put it on `ApiError`.
> 2. `backend/src/services/error-tracking.ts` — the only backend importer of the SDK. Export an `initErrorTracking(role: 'api' | 'worker')` and a `captureError(err, context)`. Both are no-ops when the DSN is unset or the environment is in `OVERRIDE_ENVIRONMENTS`. Scrub by **allowlist**: send the message, the stack, the `requestId`, the matched route, the status and the role — nothing else. Import `isStrict` from `config/validate-env.ts` rather than re-deriving the environment check.
> 3. Call it from `middleware/errorHandler.ts` (5xx and non-`AppError` only, next to the existing `log.error`) and from `process-guards.ts` (both handlers, before the existing behaviour, which does not change: log-and-stay-up on a rejection, log-and-exit on an uncaught exception).
> 4. `backend/src/config/validate-env.ts` — add `SENTRY_DSN` to `KNOWN_VARIABLES`. It is **optional**, so if it earns a rule at all it is a shape check on the DSN's form, never a required-when-strict rule. Say which you chose in a comment.
> 5. `frontend/src/services/error-tracking.ts` — the SPA's single importer. Initialise from `import.meta.env.VITE_SENTRY_DSN`, no-op when unset or in dev. **No Session Replay, no `sendDefaultPii`.** Drop every event whose route has `meta.public`, using the router's current route rather than parsing the URL. Attach the `requestId` from an `ApiError` when the error carries one.
> 6. `frontend/src/main.ts` — install it, and wire `app.config.errorHandler` plus an `unhandledrejection` listener.
> 7. `frontend/vite.config.ts` — add the ingest origin to `connect-src`, derived from the DSN so a deployment cannot set one and forget the other. If the DSN is unset, add nothing.
>
> **Do not touch** anything listed under "Out of scope". One file needs care rather than avoidance: **`requestLog.ts` is edited by `feature/0031-production-deployment` too** — that branch changes the `IGNORED` set at line 44, and step 1 adds a line at roughly 48. They are close enough to conflict on merge; the resolution is to keep both changes, and neither is subtle.
>
> **Verify:** `npm run test:backend`, `npm run test:integration`, `npm run test:frontend`, `npm run test:e2e`, `cd backend && npx tsc --noEmit`, `npm run build --workspace=frontend`. Then confirm the two silent-failure paths by hand, because no suite covers them: build the SPA **with** a DSN set and grep the emitted `index.html` for the ingest origin in `connect-src`; and run the API with an obviously invalid DSN to confirm it neither crashes nor blocks a request. Report the real output.
>
> **On the way out:** run `sot-sync`. [08-operations §Observability](../docs/sot/08-operations.md#observability) is the main one — strike item 2 of the numbered list, add both variables to the configuration table with the compile-time caveat, and say what is and is not sent. [07-security](../docs/sot/07-security-and-privacy.md) gains a third-party processor and a new outbound destination: add it to the trust boundaries and to the data inventory, and state that the respondent surface is excluded and why. Note that [`06-api-reference`](../docs/sot/06-api-reference.md) now needs the `X-Request-Id` response header documented. Remove the error-tracking row from `docs/BACKLOG.md`, add the `report-uri`-in-a-meta-tag finding to the CSP-reporting row, strike D4 in [10-saas-roadmap](../docs/sot/10-saas-roadmap.md) in both the table and the §D paragraph, and set this file to `**Status:** done` with an Outcome recording the deployment-template variables still owed once 0031 merges. Run `ship-checklist` before the PR.

## Outcome

Built as specified. `backend/src/services/error-tracking.ts` and `frontend/src/services/error-tracking.ts` are the only modules importing the SDK; `@sentry/node` and `@sentry/vue` are both pinned at 10.73.0.

**Verified:** backend 25 specs / **326 tests**, integration 25 specs / **250 tests** (10 skipped — the Redis-gated ones, unchanged), frontend 53 specs / **435 tests**, E2E **53 tests**, `tsc --noEmit` clean, frontend build clean. Each group of new tests was run against the unwired code first and seen to fail: 4 for the `X-Request-Id` header, then 5 for the error-handler wiring.

Beyond the suites, the four things no suite covers were checked by hand:

- built the SPA **with** a DSN — `connect-src` in the emitted `index.html` contains `https://o4507.ingest.de.sentry.io`;
- built it **without** one — `connect-src` is unchanged;
- built it with a **malformed** DSN — the build fails, exit 1, with the message naming the variable;
- ran the built API with a valid DSN — it boots, serves, and a 404 is logged as `request refused` (no event), with `X-Request-Id` and `Access-Control-Expose-Headers: X-Request-Id` both present on the response.

**One finding changed the design mid-implementation, and it is the reason the spec's own plan for `SENTRY_DSN` was wrong.** The spec said the variable should be optional and that a shape check was discretionary. Running the built API with `SENTRY_DSN=totally-not-a-dsn` showed the SDK **does not reject a bad DSN**: it logs to its own debug channel, disables itself, and the process boots, serves and reports nothing — no error on any path anybody watches. That is precisely the silent failure this feature exists to remove, and it was inconsistent with the frontend, which fails the build. So `validateEnv` now refuses to boot on a malformed DSN, following the `WEBHOOK_SIGNING_KEY` precedent exactly: absence is fine, presence-and-unusable is not.

**Three deviations from the execution prompt:**

1. **`sentryIngestOrigin` lives in `frontend/src/services/sentry-dsn.ts`, not in `vite.config.ts`.** Written in the config first, as the prompt said — but a spec importing that file pulls vite's own internals into jsdom and dies before reaching an assertion. Extracting it made the rule testable, which was the point of asking for a test over it.
2. **`api.ts` reads the header with `?.`.** Three existing `api.spec.ts` cases mock a `Response` with no `headers` and began failing with a `TypeError`. The guard is not test appeasement: that line runs *while constructing an `ApiError`*, so a throw there replaces the real failure with a `TypeError` and loses the reason — the same rule both tracking modules follow.
3. **The `headersSent` branch of `errorHandler` reports too.** Not in the prompt. A stream that dies mid-write is a genuine fault and one of the few this API can produce where the client gets a truncated body and no status explaining it.

**Documentation drift found and corrected while syncing:** `docs/sot/README.md` still listed the landing page as designed-but-not-built, which [10-saas-roadmap](../docs/sot/10-saas-roadmap.md) has said since 2026-09-02 shipped at `docaiflow.com`. Corrected from the roadmap's evidence, and flagged here rather than fixed silently.

**Filed, not fixed:** errors on the public respondent surface are still invisible, deliberately, and nothing alerts on a tracked error. Both are rows in `docs/BACKLOG.md`.

**Still owed:** `SENTRY_DSN` and `VITE_SENTRY_DSN` need adding to the deployment templates on `feature/0031-production-deployment` (`backend/.env.local.example`, `frontend/.env.local.example`, `deploy/railway/*.env.example`), untouched here under this spec's scope fence. Both `.env.example` files in this repo document them already. Note also that `requestLog.ts` is edited by both branches — 0031 changes the `IGNORED` set, this adds a `setHeader` a few lines below — so expect a small conflict on merge and keep both.
