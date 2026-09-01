# 0018 — One rate limit for the whole service, not one per replica

**Status:** done
**Priority:** P1 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md) — *Shared rate-limit store (Redis)*)
**Branch:** `feature/0018-shared-rate-limit-store`
**Related:** [07-security-and-privacy](../docs/sot/07-security-and-privacy.md) · [04-backend-patterns §7](../docs/sot/04-backend-patterns.md) · [08-operations](../docs/sot/08-operations.md) · [09-quality-and-testing](../docs/sot/09-quality-and-testing.md) · [`features/0002`](0002-rate-limiting-on-public-write-paths.md) · [`features/0017`](0017-job-queue-for-pdf-embedding.md)

## Context

[`features/0002`](0002-rate-limiting-on-public-write-paths.md) put a named per-IP limiter on every unauthenticated write path and deliberately left one thing open, recorded as S2's residual in [07-security](../docs/sot/07-security-and-privacy.md): **the store is in-memory**. `backend/src/middleware/rateLimit.ts` gives each limiter its own `MemoryStore`, so the effective limit is multiplied by the number of replicas and reset by every deploy. At one replica that is correct and cheap. The moment the service scales out it is a security control that quietly does a fraction of its job.

It has sat in P1 blocked on infrastructure rather than on a decision: it needs a Redis, and there was none. [`features/0017`](0017-job-queue-for-pdf-embedding.md) brought one and deliberately did **not** touch the limiters, because a security-relevant change does not belong in a queue PR. So this is now unblocked and is the whole of what is left.

The chain also wants it before step 10 of the [build order](../docs/sot/10-saas-roadmap.md#build-order). A public API with API keys is the first surface where a caller drives the product without a browser, and per-process limits on a multi-replica deployment are not a limit anybody can be told about in documentation.

**No prior attempt.** `git log --all` has one rate-limit commit (`5944b2e`, features/0002) and no revert. What *is* prior art, and must be read before writing any code here, is [`features/0017`](0017-job-queue-for-pdf-embedding.md)'s Outcome: its Redis client hung the request path, `saas-readiness-reviewer` found it, and the same mistake made here would hang **login** instead of a background embed.

## Why the obvious approach is wrong

### 1. `REDIS_URL` unset must keep meaning "in-memory" — and `REDIS_URL` set but broken must not quietly mean the same thing

The tempting move is to copy [`features/0017`](0017-job-queue-for-pdf-embedding.md) wholesale, since it already established the pattern: Redis absent ⇒ degrade to the old behaviour, silently, and carry on. **Half of that is right here and half of it is dangerous, and the difference is what the degradation costs.**

For the queue, falling back to the inline embed is a *correct* execution of the same work, just in a worse place. For a limiter, falling back to per-process counting is a **weakening of the only control standing in front of credential stuffing**, and it happens precisely in the deployment that scaled out — the one where it matters. A control that gets weaker exactly when it is needed, without saying so, is worse than not having it, because the operations documentation now contains a false statement.

So the shape is:

- **`REDIS_URL` unset ⇒ `MemoryStore`, exactly as today.** Keep it. It is correct at one replica, it is what every suite runs on, and it is the rollback. It must be **logged once at startup**, so "which store is this process using" is answerable from the logs rather than by reading the environment.
- **`REDIS_URL` set ⇒ the Redis store, and a store failure is a decision that has to be argued in writing**, not defaulted into. See trap 2.

### 2. The store-error behaviour is the actual design decision, and `passOnStoreError` is where it is made

`express-rate-limit@8.6.2` (verified in `node_modules/express-rate-limit/dist/index.d.ts:502-505`) has `passOnStoreError: boolean` — *"If the Store generates an error, allow the request to pass"* — and it defaults to `false`. So doing nothing is already a choice, and it is the strict one: a Redis that errors turns every login into a failure rather than an unlimited one.

The two candidates, with what each actually costs:

| | Redis is down and… | Cost |
|---|---|---|
| `passOnStoreError: false` (**recommended**) | …every limited request fails | A Redis outage becomes a login/registration/submission outage. Loud, immediate, and impossible to miss |
| `passOnStoreError: true` | …every limited request passes | A Redis outage silently removes rate limiting from every unauthenticated write path, for as long as it lasts, with a 200 on every request |

**Recommendation: `false`, and argue it in [07-security](../docs/sot/07-security-and-privacy.md) rather than leaving it implicit.** The reasoning to record: an outage this product can see and roll back from (empty `REDIS_URL`, restart) is preferable to an invisible removal of the control that S2 exists for. Whoever executes this may reach the opposite conclusion — that is allowed — but **rule 2 of [07-security](../docs/sot/07-security-and-privacy.md) applies**: the behaviour ships with an argument in that document and a test proving it, either way.

A third option exists and should be rejected explicitly so nobody reinvents it half-way: a store that *falls back* to memory when Redis errors. It sounds like the best of both and it is the worst: the limiter would silently switch between two counting models mid-incident, the logs would show limits being enforced, and nobody could say afterwards what limit was actually in force at any moment.

### 3. A limiter's Redis client is on the request path, and 0017 has already shown what that costs

This is the trap that has already bitten this repository once, one feature ago, and it would land somewhere much worse here.

`services/embed-queue.ts` built its ioredis client with `maxRetriesPerRequest: null` — required by BullMQ's worker — and ioredis' default `retryStrategy` never gives up. A Redis that was unreachable rather than actively refusing therefore made the command wait for a connection that never arrived, and `POST /api/forms/:formId/fields/bulk` never answered. The fix is in `connect()` there: **connection options by role**, plus a wall-clock deadline (`withDeadline`) so the property does not depend on a library's internals.

The limiter store is called **on every login**. Get this wrong and a misconfigured or unreachable Redis does not slow the site down, it makes authentication hang — an outage with no error message anywhere. Whatever client this feature uses must be bounded in both connection and command time, and there must be a test that points `REDIS_URL` at an unroutable address and asserts that `POST /api/auth/login` still **answers**, within seconds. `backend/tests/integration/pdf-embed-fallback.spec.ts` is the model, including its use of TEST-NET-1 (`192.0.2.1`) for an address that black-holes rather than refuses.

### 4. Two importers of `ioredis` is how the two connection policies drift apart

After [`features/0017`](0017-job-queue-for-pdf-embedding.md), `services/embed-queue.ts` is the only module that imports `ioredis`, and it holds all the hard-won knowledge about how to configure a client for each role. Giving the limiter its own `new IORedis(...)` copies the *easy* half of that knowledge and leaves the hard half behind — which is exactly how the hang in trap 3 would reappear.

**Extract `backend/src/services/redis.ts`**: one module that owns connections and their per-role options, with `embed-queue.ts` refactored onto it and importing `ioredis` no longer. It is the same rule `services/pdf-storage.ts` follows for bytes and `services/stripe.ts` for the Stripe SDK ([04-backend-patterns §8](../docs/sot/04-backend-patterns.md)). Keep the roles explicit and keep 0017's comments about *why* each one differs — they are the reason the module exists.

### 5. A shared store no longer forgets, and that changes the support story

Today a deploy resets every counter. That is a bug being fixed — and it is also, accidentally, the unlock mechanism for anyone who has locked themselves out. After this change:

- A legitimate user who exhausts the login limit **stays** locked out across restarts for the whole window. There is no unlock path and no support tool, and `RATE_LIMIT_LOGIN_WINDOW_MS` is 15 minutes by default. That is acceptable, and it must be **written down in [08-operations](../docs/sot/08-operations.md)** with the one command that clears a key, because the first support ticket will otherwise be answered by restarting the API, which no longer works.
- A wrong `TRUST_PROXY_HOPS` now poisons a *shared* store rather than one process's memory: if `req.ip` collapses to the load balancer's address, one attacker exhausts the limit for every user at once and a restart does not clear it ([08-operations](../docs/sot/08-operations.md#trust_proxy_hops-and-why-it-is-not-a-detail)). The interaction is not new; its blast radius is.

### 6. The five limiters must not share one counter, and the suites' reset must keep working

Each limiter has its own `MemoryStore` today, and `resetRateLimitStores()` — called in the `beforeEach`/`afterEach` of `backend/tests/rate-limit.spec.ts` and relied on because the suites share one `app` — resets all of them. Two things follow:

- Whatever Redis store is used must be given a **distinct key prefix per limiter**, under `REDIS_KEY_PREFIX` (`vuepdf` by default, `services/embed-queue.ts`), or a burst of form submissions starts consuming somebody's login budget.
- `resetRateLimitStores()` must keep doing what its callers expect for **both** store types. Check what the chosen store actually implements — `resetKey` is universal, `resetAll` is not — before assuming the existing helper still works. The suites run on `MemoryStore`, so a broken `resetAll` on the Redis path will not show up in `npm test`; only the new Redis-backed spec will catch it.

## Goal

**Behaviour**

1. `REDIS_URL` unset ⇒ every limiter uses `MemoryStore` and behaves exactly as today. **Every existing test passes unmodified**, including `backend/tests/rate-limit.spec.ts`.
2. `REDIS_URL` set ⇒ every limiter counts in Redis, and **two independently constructed limiters in one process share a count** — the property that makes it a limit for the service rather than for a replica. Tested against a real Redis.
3. The five limiters have separate counters; exhausting one does not affect another. Tested.
4. Which store is in use is logged once at startup.

**Failure**

5. A store error resolves to a decided, documented behaviour — `passOnStoreError: false` unless the executor argues otherwise in [07-security](../docs/sot/07-security-and-privacy.md) — and there is a test that asserts it rather than a comment claiming it.
6. `REDIS_URL` pointing at an unroutable address ⇒ `POST /api/auth/login` still **answers**, within a few seconds. Tested with an address that black-holes, not one that refuses.

**Structure**

7. `backend/src/services/redis.ts` is the only module importing `ioredis`; `services/embed-queue.ts` uses it and no longer imports the library itself. Its per-role connection options and the reasoning behind them survive the move.
8. Keys are namespaced under `REDIS_KEY_PREFIX`, one namespace per limiter.
9. `resetRateLimitStores()` works for both store types.

**Configuration**

10. `REDIS_URL: ''` is pinned in `backend/vitest.config.ts`, `backend/vitest.integration.config.ts` **and `playwright.config.ts`** — the last one does not pin it today, which was survivable when Redis only moved the embed and is not now that it moves authentication ([09-quality-and-testing](../docs/sot/09-quality-and-testing.md)).
11. `backend/.env.example` documents that `REDIS_URL` now drives two things, not one.

**Must not change**

12. No new endpoint, no new limiter, no change to any limit or window default.
13. `POST /api/billing/webhook` still has no limiter, and the argument for that in [07-security](../docs/sot/07-security-and-privacy.md) is untouched.
14. The embed queue's behaviour is unchanged: same job shape, same fallback, `tests/integration/pdf-embed-queue.spec.ts` and `pdf-embed-fallback.spec.ts` pass unmodified.

## Out of scope

- **A global fallback rate limiter** on everything else — its own P1 row, and it needs traffic data nobody has, not a store.
- **Account-level lockout** (S10). It needs a notification and unlock flow designed with it, or it becomes a way to lock a named user out on purpose.
- **Moving any other state into Redis** — sessions, caching, the organization lock. `services/organization-lock.ts` stays in-process; its remaining cross-replica case is billing checkout, which has a Stripe idempotency key behind it ([`features/0014`](0014-close-the-subscription-surface.md)).
- **A support tool or endpoint for clearing a locked-out user.** Trap 5 requires the runbook command, not a UI. File the UI if it is wanted.
- **Making Redis mandatory.** Unset stays valid and stays the default.

## Execution prompt

> Move the rate limiters off per-process memory onto the Redis that [`features/0017`](0017-job-queue-for-pdf-embedding.md) brought, without making Redis mandatory and without weakening the control when Redis is absent. Read this whole spec first, and then read [`features/0017`](0017-job-queue-for-pdf-embedding.md)'s Outcome — its Redis client hung the request path in a way a code review caught and no test would have, and the same mistake here hangs login.
>
> **Read first.**
>
> - `backend/src/middleware/rateLimit.ts` — all five limiters, the per-limiter store, and `resetRateLimitStores`.
> - `backend/src/services/embed-queue.ts` — `connect()` and its per-role options, `withDeadline`, and the comments explaining why each role differs. This is the module you are extracting from.
> - `backend/tests/rate-limit.spec.ts` — how limits are driven through `process.env` rather than by reaching into a limiter, and why the reset has to settle a tick first.
> - `backend/tests/integration/pdf-embed-fallback.spec.ts` — the shape of an "unreachable Redis" test, and why refused and black-holed are different cases.
> - [07-security §rule 2](../docs/sot/07-security-and-privacy.md) — the standard of proof this repository holds rate limiting to.
>
> **Apply the skills:** `backend-endpoint-pattern` for anything that touches a route, then `sot-sync` and `ship-checklist`.
>
> ---
>
> **Step 1 — extract `services/redis.ts`.** Connections and per-role options only; `embed-queue.ts` refactored onto it and no longer importing `ioredis`. **No behaviour change at all**, and the whole suite plus `TEST_REDIS_URL=… npm run test:integration` must prove it. Commit here.
>
> **Step 2 — the failing test.** Write the multi-replica test **before** the store: two limiters constructed independently, one Redis, asserting they share a count. Run it against the `MemoryStore` implementation and watch it fail — if it passes, it is not testing what it claims and the two limiters are probably the same instance.
>
> **Step 3 — the Redis store**, behind `REDIS_URL`, with the decided `passOnStoreError` behaviour, per-limiter key namespaces, and bounded connection and command timeouts.
>
> **Step 4 — the failure paths.** The unroutable-Redis test (goal 6) and the store-error test (goal 5). Then pin `REDIS_URL: ''` in `playwright.config.ts` and confirm the E2E suite is unaffected.
>
> **Do not** make Redis mandatory, do not add a global limiter, do not change any limit default, and do not build a memory-fallback store (trap 2).
>
> **Verify:**
> ```bash
> npm run test:backend
> npm run test:integration
> TEST_REDIS_URL=redis://localhost:6379 npm run test:integration
> npm run test:frontend
> npm run test:e2e
> npm run build --workspace=frontend
> cd backend && npx tsc --noEmit && npm run typecheck:tests
> ```
> Then by hand, with `docker compose up -d redis`: start **two** API processes on different ports against one Redis, exhaust the login limit on the first, and confirm the second one refuses too — that is the whole feature, and no single-process test can show it. Restart both and confirm the counter survived.
>
> **Before the PR:** run `saas-readiness-reviewer`. This changes a security control and puts a network dependency on the authentication path.
>
> **Documentation exit, required:**
> - [`07-security-and-privacy`](../docs/sot/07-security-and-privacy.md): S2's residual is closed for the shared-store half; record the `passOnStoreError` decision and its argument beside the webhook's, to the same standard.
> - [`04-backend-patterns §7`](../docs/sot/04-backend-patterns.md): the limiter pattern is unchanged, the store behind it is now configuration.
> - [`08-operations`](../docs/sot/08-operations.md): `REDIS_URL` now drives two subsystems; how to tell which store a process is using; **how to clear a locked-out user's key**; what a Redis outage does to authentication; and that the rollback is emptying `REDIS_URL`.
> - [`09-quality-and-testing`](../docs/sot/09-quality-and-testing.md): the new specs and which of them need a Redis; the counts; and `playwright.config.ts` joining the list of configurations that pin `REDIS_URL`.
> - [`02-architecture`](../docs/sot/02-architecture.md): Redis stops being "the queue's Redis" in the topology.
> - [`docs/BACKLOG.md`](../docs/BACKLOG.md): close the *shared rate-limit store* row. Leave *account-level lockout* and *a global fallback rate limiter* open. Add a row for a way to clear one locked-out identity without redis-cli, if the runbook command turns out to be the only answer.
> - `CLAUDE.md`: the current-state paragraph says the three unauthenticated write paths are rate limited per IP; say where the count now lives.
> - This file: `**Status:** done` and an **Outcome** — what shipped, the real test output, the failing-test-first evidence for goal 2, what the two-process manual check showed, and the `passOnStoreError` decision as it was finally argued.

## Outcome

**Shipped**, in two commits: the extraction (`3fdbd7b`) and the store (`83f4238`).

### What shipped

- `backend/src/services/redis.ts` — the only module that opens a Redis connection, and now the only one that imports `ioredis` at all (the `Redis` type is re-exported so not even a type import escapes it). `connectRedis(role)` carries the per-role options and the reasoning behind each.
- `backend/src/middleware/rateLimit.ts` — the five limiters became a named catalogue plus `buildRateLimiter(name)`. With `REDIS_URL` set they count in Redis (`rate-limit-redis`), one key namespace per limiter under `REDIS_KEY_PREFIX`; without it, `MemoryStore` exactly as before.
- `backend/tests/integration/rate-limit-store.spec.ts` (3 tests, needs `TEST_REDIS_URL`) and `rate-limit-failure.spec.ts` (3 tests, **needs no Redis, so CI runs it**).
- `playwright.config.ts` pins `REDIS_URL: ''`, joining the two vitest configs.

### The failing test, first

Written before the store and run against `MemoryStore`:

```
× counts a client once across two independently built limiters
× gives each limiter its own counter, so one cannot exhaust another
× keeps counting across a restart, unlike the in-memory store
  AssertionError: expected 200 to be 429
```

The middle one was **my test being wrong, not the code**: `login` carries `skipSuccessfulRequests`, so a probe that answers 200 is refunded every hit and the limiter never bites. Using `responses` and `register` fixed it, and that test then passed on both stores — which is correct, since separate counters are true of the memory store too. The other two are the property this feature exists for, and they failed for exactly the right reason.

### Two decisions, both argued rather than defaulted into

**`passOnStoreError: false`.** A Redis outage rejects limited requests instead of letting them through. The alternative is not a degraded limiter — it is *no* limiter on the entire unauthenticated write surface for the duration, with a 200 on every request and nothing in the logs. The argument is now in [07-security](../docs/sot/07-security-and-privacy.md) to the same standard as the webhook's missing limiter, and `rate-limit-failure.spec.ts` asserts that ten requests against a dead store never answer 200. The memory-fallback store the spec told me to reject was rejected.

**`enableOfflineQueue` stays on, and this one was measured, not reasoned.** Turning it off is the obvious way to make an outage fail fast, and it does — 15.5 s per request down to 0.5 s. It also breaks the healthy case: with the offline queue disabled, the first command issued while the socket is still connecting fails against a perfectly good Redis with *"Stream isn't writeable"*. That did not show up running the new spec alone; it turned it red the moment two spec files shared a process, which is the closest thing to production the suite has. **Bounding the timeouts was the right lever; refusing to wait at all was not.** With `connectTimeout`/`commandTimeout` at 2 s the black-hole case answers in ~4 s and the healthy case is unaffected.

That is also why the `rate-limit` role exists in `services/redis.ts` rather than sharing the queue's options: the limiter sits in front of login, and the queue's 10 s command timeout is a fine number for a background embed and a terrible one for a sign-in.

### Verification

```
npm run test:backend                                     16 specs, 206 tests passed
npm run test:integration                                 16 specs, 145 passed, 2 specs (6 tests) skipped
TEST_REDIS_URL=… npm run test:integration                18 specs, 151 tests passed
npm run test:frontend                                    38 specs, 321 tests passed
npm run test:e2e                                         50 passed (18.8s)
npm run build --workspace=frontend                       built in 5.77s
cd backend && npx tsc --noEmit && npm run typecheck:tests clean
```

**Two replicas against one Redis** — the check no single-process test can make. `RATE_LIMIT_LOGIN_MAX=3`, one API on 3101 and another on 3102:

```
Rate limiting is counting in Redis (shared across every replica)   (both processes)
A:401 A:401 A:401          three failed logins against the first replica
B:429                      the fourth, against the second one
{"error":"Too many failed login attempts. Please wait a few minutes and try again."}
after restart: 429         a third process, started fresh - the counter survived
key: vuepdf-manual:rl:login:::1/56
```

Before this feature the fourth attempt on replica B would have been a `401` — a fresh counter — and the restart would have cleared everything.

### What was deliberately not done

No global fallback limiter, no account-level lockout, no other state moved into Redis, and Redis is still optional. `services/organization-lock.ts` stays in-process.

One row was **added** rather than closed: clearing a locked-out identity is a documented `redis-cli DEL`, which is fine for an operator and is not a support process. It belongs with the unlock flow that account-level lockout needs anyway.

`rate-limit-store.spec.ts` joins the queued-embed spec in needing `TEST_REDIS_URL`, which no workflow sets. One Redis service in the integration job would close both, and that gap is filed in [09-quality-and-testing](../docs/sot/09-quality-and-testing.md).

### One thing found on the way, and left alone

Limiters are now built on their **first request** rather than at import, because `src/app.ts` calls `dotenv.config()` in its body and ES imports evaluate first — so at import time `backend/.env` has not been read. That is not new: `windowMs` has always been read at import, which means a `RATE_LIMIT_*_WINDOW_MS` in a developer's `.env` has never taken effect locally, while the *limit* (read per request) has. Not fixed here — it changes no production behaviour, since a deployment passes real environment variables rather than a `.env` file — and not worth a backlog row on its own; the laziness introduced here makes the store immune to it, which was the part that mattered.
