# 0008 — A session that can be cut short

**Status:** done
**Priority:** P1 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md); S4 in [07-security-and-privacy](../docs/sot/07-security-and-privacy.md))
**Branch:** `feature/0008-session-hardening`
**Related:** [`07-security-and-privacy`](../docs/sot/07-security-and-privacy.md) (S4) · [`03-domain-model`](../docs/sot/03-domain-model.md) · [`04-backend-patterns`](../docs/sot/04-backend-patterns.md) · [`06-api-reference`](../docs/sot/06-api-reference.md) · [`08-operations`](../docs/sot/08-operations.md)

## Context

Finding S4, and the **last remaining High** in [07-security-and-privacy](../docs/sot/07-security-and-privacy.md). The session today, read out of the code:

- `backend/src/routes/auth.ts:49-53` and `:85-89` sign `{ userId }` with `JWT_EXPIRES_IN`, default **`7d`**.
- `frontend/src/services/auth.ts:22,28` put that token in `localStorage`; `frontend/src/services/api.ts:2` reads it back for every request.
- `backend/src/middleware/auth.ts:23` verifies it. There is no `tokenVersion`, no blacklist, no refresh.
- Logout is `localStorage.removeItem('token')` (`services/auth.ts:38`). The token stays valid for the rest of the week.

So: any XSS on the SPA origin yields **seven days of full account access**, and there is no way to cut it short — for the user, for support, or for the owner of the repository. `JWT_SECRET` rotation is the only revocation and it logs out every user at once. That is the actual defect; the `localStorage` part is how it gets stolen, not why it is severe.

[`features/0007`](0007-security-headers-and-csp.md) narrowed the XSS path with a CSP. It did not remove it, and the CSP still carries `style-src 'unsafe-inline'`.

## Why the obvious approach is wrong

**The obvious approach is "move the JWT into an `httpOnly` cookie". Done on its own, it trades one vulnerability for a worse one.**

A `Bearer` token in an `Authorization` header is **immune to CSRF**: a cross-site form post cannot set a header. A cookie is attached by the browser automatically, to every request, whoever caused it. The moment the session moves to a cookie, every authenticated `POST`, `PUT`, `PATCH` and `DELETE` in this API becomes forgeable from any site the user visits — and none of them has any CSRF defence today, because none has ever needed one. **A cookie migration that does not ship a CSRF defence in the same change is a regression, not a hardening.**

Three more things that are not obvious until you look at this code specifically:

**1. `httpOnly` alone does not shorten anything, and shortening is the point.**
A 7-day cookie that JavaScript cannot read is still a 7-day credential; it just moves where the theft has to happen. The severity in S4 comes from *duration* and *irrevocability*. If you only get to do one part of this feature, do the short access token plus refresh with revocation — that is what makes a compromise end. `httpOnly` is the second half.

**2. The cookie only works if the SPA and the API are same-site, and nothing currently guarantees that.**
They are separate origins: `localhost:5173` and `localhost:3000` in development, and `VITE_API_URL` is compile-time so they are separate in production too ([08-operations](../docs/sot/08-operations.md)). Ports do not affect same-site, so a `SameSite=Lax` cookie works fine in development and will mislead you. In production, `app.example.com` → `api.example.com` is **same-site** and works; `app.example.com` → `api.some-other-host.com` is **cross-site**, and a cross-site cookie needs `SameSite=None; Secure`, which Safari's ITP and Firefox block outright as a third-party cookie. It would work on the developer's Chrome and fail for a real customer on Safari. **This is a deployment constraint that must be written into [08-operations](../docs/sot/08-operations.md) as a requirement**, next to the CSP header requirement `0007` left there, and it must be verified before the cookie half is called done.

**3. The client can no longer answer "am I logged in?" synchronously, and the router depends on it.**
`frontend/src/router/index.ts:62` calls `authService.isAuthenticated()` in `beforeEach`, which is `!!localStorage.getItem('token')` (`services/auth.ts:42`). With an `httpOnly` cookie that function cannot work. Do **not** solve this by having the API also write a JS-readable copy of the token — that reintroduces exactly what the change removes. The store already persists `user` to `localStorage` under `vuepdf-auth` (`stores/auth.store.ts:63-68`) and `isAuthenticated` is `!!user.value`, so the honest fix is that the persisted user is a *hint* for routing and `/api/auth/me` is the authority.

**One prior-art note:** there is no reverted attempt at this in `git log`. Nothing has been tried and abandoned here — unlike the bulk-save defect, which was fixed and reverted once (`fb8acd8`, `771b77c`) before [`features/0001`](0001-stable-field-ids-and-safe-bulk-save.md) got it right.

## Goal

1. Access tokens expire in **minutes, not days** (default ≤ 15 min), configurable, with the default in `backend/.env.example`.
2. A refresh flow issues a new access token without re-entering a password, and the E2E suite passes with an access-token lifetime short enough that at least one test crosses a refresh.
3. **A session can be revoked and the revocation actually takes effect**, within one access-token lifetime, without rotating `JWT_SECRET` and without affecting other users.
4. Logout revokes server-side. After logout, a captured refresh token is rejected.
5. Refresh tokens **rotate** on use, and reuse of an already-used refresh token is detected and invalidates that session family.
6. Every authenticated write path is protected against CSRF, **if and only if** the session moved to a cookie. If it did not, that is recorded as still-open with the reason.
7. `frontend/src/services/upload.ts:100` (XHR, sets `Authorization` by hand) and `api.ts`'s `download()` both still work — these are the two call sites that do not go through `request()`.
8. The router guard no longer depends on reading a token from `localStorage`.
9. Whatever part of S4 is **not** done is written down in [07-security-and-privacy](../docs/sot/07-security-and-privacy.md) with its reason and filed in [`docs/BACKLOG.md`](../docs/BACKLOG.md) — with the same honesty [`0007`](0007-security-headers-and-csp.md) applied to `style-src`.
10. All four suites green: `npm run test:backend`, `npm run test:integration`, `npm run test:frontend`, `npm run test:e2e`, plus `npx tsc --noEmit` in `backend/` and `npm run build --workspace=frontend`.

## Out of scope

- **Account-level lockout, password policy, breach check** (S10) — its own backlog row, and it needs an unlock path designed with it.
- **MFA and SSO.** Not on the roadmap.
- **Account deletion and data export** (S8) — separate row, though it will want the same revocation primitive.
- **Organizations and roles.** This feature must not anticipate them: it stores a session for a `User`, and [10-saas-roadmap](../docs/sot/10-saas-roadmap.md) step 4 re-points ownership later.
- **Building the deployment that makes the cookie same-site.** Record the requirement; there is still no deploy pipeline.

## Execution prompt

> Read [07-security-and-privacy](../docs/sot/07-security-and-privacy.md) and the "Why the obvious approach is wrong" section above before writing anything. Then work in this order — it is sequenced so the valuable half lands first and the risky half cannot be half-done.
>
> **Step 1 — read before writing.** `backend/src/routes/auth.ts` in full, `backend/src/middleware/auth.ts` (29 lines), `backend/prisma/schema.prisma` (`User` has no session relation today), `frontend/src/services/api.ts` (`request`, and `download` at `:58` which builds its own headers), `frontend/src/services/auth.ts`, `frontend/src/services/upload.ts:98-105` (raw `XMLHttpRequest`), `frontend/src/stores/auth.store.ts` (note `persist` at `:63-68`), `frontend/src/router/index.ts:58-80`. Also `backend/src/app.ts` for the CORS block — `credentials: true` and a pinned origin are already there, which the cookie half needs. Confirm each of these yourself; do not trust the line numbers above if the file has moved on.
>
> **Step 2 — decide the revocation primitive, and write the decision down before building it.** Two shapes work:
> - `User.tokenVersion Int @default(0)`, embedded in the access token and compared on verify. Cheap, one migration, no new table — but it makes `middleware/auth.ts` hit the database on every authenticated request, which it currently never does.
> - A `RefreshToken` table (`id, userId, hashedToken, family, expiresAt, revokedAt, createdAt`), with access tokens left stateless and revocation acting on refresh only.
>
> The second is the one that supports goal 5 (rotation and reuse detection) and it is what the roadmap's `ApiKey` design already resembles ([10-saas-roadmap](../docs/sot/10-saas-roadmap.md)). Pick with reasons in the PR. **Store a hash of the refresh token, never the token** — that table is a credential store, and it must survive being read.
>
> **Step 3 — schema, via the `prisma-schema-migration` skill.** Before writing any `onDelete`, read the cascade map in [03-domain-model](../docs/sot/03-domain-model.md) and answer its question in the PR description: `RefreshToken.user → User` should be `Cascade` (a deleted user's sessions are worthless, and no customer data is in that table), but say so explicitly rather than letting it default. Add the index the refresh lookup needs.
>
> **Step 4 — backend, tokens first, cookie later.** Shorten the access token (`JWT_ACCESS_TTL`, default 15 min) and add `POST /api/auth/refresh` and `POST /api/auth/logout`, following the `backend-endpoint-pattern` skill — Zod at the edge, `AppError` plus `next(error)`, and a **transaction** around rotate-and-issue so a crash cannot leave a session with no valid refresh token. Rate limit `refresh` with a named limiter as §7 of [04-backend-patterns](../docs/sot/04-backend-patterns.md) requires: it is an unauthenticated write path by definition. Keep `JWT_EXPIRES_IN` working or remove it deliberately and say which.
>
> **Step 5 — the failing tests, before the fix.** In `backend/tests/` (mocked Prisma) for the routes and shapes; in **`backend/tests/integration/`** for anything that is a database claim — revocation actually taking effect, rotation, and reuse detection are all database behaviour, and rule 6 in `CLAUDE.md` exists because a mocked Prisma passed the last defect that shipped. Write the reuse-detection test first and watch it fail.
>
> **Step 6 — frontend, in one place.** All requests go through `request()` in `services/api.ts` except two: `download()` at `:58` and the `XMLHttpRequest` in `services/upload.ts:100`. Whatever you change, change all three, and make the refresh-on-401 retry live in `request()` alone — with a single-flight guard, or a burst of parallel 401s will fire a refresh each and, with rotation on, invalidate each other. That is the bug this step exists to avoid.
>
> **Step 7 — the cookie, only if step 2's decision holds up.** `httpOnly`, `Secure`, `SameSite=Lax`, `Path=/api/auth/refresh` for the refresh cookie. Then the CSRF defence, which is not optional: `SameSite=Lax` blocks cross-site `POST`, and an `Origin`/`Sec-Fetch-Site` check on state-changing requests closes the rest. Add it as one guard in `middleware/`, applied at the routes like `authenticate` is (§2 of [04-backend-patterns](../docs/sot/04-backend-patterns.md)), never as a blanket layer. **Write a test that a cross-origin `POST` is rejected** — CSRF protection with no test asserting a rejection is decoration. If the cross-site problem in point 2 above makes the cookie unshippable, stop here, ship steps 4–6, and record why.
>
> **Step 8 — the router.** Remove `authService.isAuthenticated()` from `router/index.ts:62`. The persisted `user` is the routing hint; `/api/auth/me` is the authority. A 401 anywhere must land the user on `/login` without a reload loop — check that by hand with an expired session, not only in tests.
>
> **Step 9 — verify.** `npm run test:backend`, `npm run test:integration`, `npm run test:frontend`, `npm run test:e2e`, `npx tsc --noEmit` in `backend/`, `npm run build --workspace=frontend`. Then by hand, which is where this feature actually fails: log in, wait past the access-token lifetime (set it to 60 s temporarily), and confirm the next action refreshes silently rather than bouncing to login; log out and confirm a captured refresh token is rejected; upload a PDF and download a CSV **after** a refresh has happened, because those are the two paths that bypass `request()`. Note that E2E runs against `npm run dev`, so any cookie flag depending on `Secure` needs a plan for plain HTTP in development — state it.
>
> **Step 10 — document.** Run `sot-sync`. [07-security-and-privacy](../docs/sot/07-security-and-privacy.md): the auth table's Session / Token storage / Revocation / Logout rows, S4's status, the "Recommended order of work" list, and — in the style `0007` set — an explicit statement of **what is still not covered**, which will at minimum include access tokens being unrevocable for their remaining lifetime. [03-domain-model](../docs/sot/03-domain-model.md): the new entity and its cascade row. [06-api-reference](../docs/sot/06-api-reference.md): the new endpoints and the new `401` semantics, after re-reading the routes (`api-contract-guard`). [04-backend-patterns](../docs/sot/04-backend-patterns.md): the CSRF guard, if it shipped. [08-operations](../docs/sot/08-operations.md): the new environment variables, and **the same-site requirement from point 2 as a deployment requirement**. [09-quality-and-testing](../docs/sot/09-quality-and-testing.md): the spec counts. Remove the session-hardening row from [`docs/BACKLOG.md`](../docs/BACKLOG.md) and file what was deferred. Close step 3 in the [build order](../docs/sot/10-saas-roadmap.md#build-order) if nothing is left in it. Set this file to `**Status:** done` and add an `## Outcome`.


## Outcome

**Done, including the cookie half.** All ten acceptance criteria hold. Verified on Node 22.22.0: backend 12 specs / 115 tests, integration 3 / 25, frontend 29 / 241, E2E 7 / 38, plus `tsc --noEmit` on the backend and the frontend build.

### The design deviates from the spec, deliberately

The spec said "move the session to a cookie" and warned that doing so introduces CSRF across an API that has no defence for it. Following that warning to its conclusion gives a better split than the one the spec sketched:

- **Refresh token** → `httpOnly` cookie, `Path=/api/auth`, `SameSite=Lax`, `Secure`. Unreadable by page script.
- **Access token** → a module variable in `services/api.ts`. Not `localStorage`, and **not a cookie**.

Because every route except `/auth/refresh` and `/auth/logout` still authenticates with an `Authorization` header, the API stays CSRF-immune and the guard is needed on exactly two endpoints instead of every write path. The long-lived credential is still unreadable, which was the point. `localStorage` now holds no credential at all — only the `user` object, as a rendering hint.

### What the code says that the spec did not know

- **`useThumbnails.ts` has no `getDocument`** and **`App.vue` had dead code**: its `onMounted` was guarded on `isAuthenticated && !user`, and `isAuthenticated` is defined as `!!user` — it could never run. Replaced with a real `bootstrap()` call.
- **Loading a PDF makes no API call.** The app opens the file locally and uploads later. The first attempt at an "expired token refreshes silently" test used a PDF load as the authenticated action and proved nothing; a request trace showed no upload at all. It now lists forms instead.

### A race this change introduced, found by the E2E suite

Two E2E tests failed after the first implementation. `DashboardView.handleLogout` called `authStore.logout()` without awaiting, then navigated. The router guard bootstrapped, the logout request was still in flight, the refresh cookie was still valid — so the session was **re-established** and `/login` (a `requiresGuest` route) bounced the user back to the dashboard. Clicking "log out" left you logged in.

Fixed in both places: the handler awaits, and the store clears local state synchronously and marks the session settled so no bootstrap can resurrect it. The store is now correct whether or not a caller awaits — the handler fix alone would have left the trap for the next caller.

### Verified, not assumed

- **Replay detection**: removing the family revocation makes exactly one integration test fail (`rejects a refresh token that was already exchanged, and kills the family`) and nothing else.
- **In a real browser**: `document.cookie` is empty, `localStorage` contains no token, a cold reload recovers the session from the cookie alone, and a refresh cookie captured before logout returns `401` when replayed after it.
- **The whole E2E suite runs with `JWT_ACCESS_TTL: '3s'`**, set in `playwright.config.ts`. Every test crosses at least one expiry, so the refresh-and-retry path has real coverage rather than a single dedicated test. Stable across four consecutive full runs.

### Deferred and filed

In [`docs/BACKLOG.md`](../docs/BACKLOG.md): session listing, per-session revocation and an idle timeout; and a local-tooling gap this work hit — nothing migrates the `vuepdf_test` database locally, so the first integration run after any migration fails with `relation does not exist` and looks like a broken test. The stale "there is no migration history" section in `.claude/skills/prisma-schema-migration/SKILL.md` was corrected in passing; it had been false since `features/0001`.

**Known limits, recorded in [07-security-and-privacy](../docs/sot/07-security-and-privacy.md#what-the-session-model-does-not-cover):** an access token cannot be revoked within its 15 minutes, and `SameSite=Lax` requires the SPA and API to be same-site — a deployment property nothing enforces and that development cannot reveal, since `localhost:5173` and `localhost:3000` are same-site. That requirement is now in [08-operations](../docs/sot/08-operations.md).

`JWT_EXPIRES_IN` was removed rather than kept: it configured a single session token that no longer exists.
