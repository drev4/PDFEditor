# 0033 — Close public registration for the private beta

**Status:** done
**Priority:** P1 — dated. The private beta is committed for **2026-09-30** (`PDFSaaS/docs/planning/ROADMAP.md`, D-039/D-040), and public opening one week after it
**Branch:** `feature/0033-close-public-registration`
**Related:** [10-saas-roadmap §D7](../docs/sot/10-saas-roadmap.md#d--the-beta-on-2026-09-30), [07-security-and-privacy](../docs/sot/07-security-and-privacy.md), [08-operations](../docs/sot/08-operations.md), [04-backend-patterns](../docs/sot/04-backend-patterns.md), [06-api-reference](../docs/sot/06-api-reference.md), [`features/0010`](0010-member-invitations-and-role-enforcement.md), [`features/0028`](0028-boot-time-configuration-validation.md)

## Context

`POST /api/auth/register` is open (`backend/src/routes/auth.ts:63`). Anybody with the URL gets an account, an organization and an owner membership. The landing at `docaiflow.com` is live and its waitlist is collecting real addresses, so the URL is now discoverable by people the beta has not admitted.

D7 in the roadmap says the mechanism can be small **and that the way back must be a switch somebody can throw, not a deploy that reverts a commit** — because public opening is scheduled for one week after the beta opens, and it is a calendar event, not an engineering task.

**Reading the code changed the shape of this feature, and this is the part a ticket could not carry.** The roadmap says "the invitation flow already exists". It does, but it does not do this job. `POST /api/organizations/invitations/accept` (`backend/src/routes/organizations.ts:498`) creates an account for an invited person who has none — and the comment at `:539` says exactly why it must not reuse the registration path: *"this person is joining someone else's organization, and giving them a second one would put them in two — which `requireMembership` is not built for and would resolve arbitrarily."* So `Invitation` admits **a customer's colleague into that customer's organization**. It cannot admit a new beta customer, who needs an organization of their own. Closing registration without adding an admission path closes the beta to everybody.

The admission mechanism was decided by the repository owner: **a shared signup code**. `REGISTRATION_MODE=invite_only` closes the endpoint, and `REGISTRATION_CODE` reopens it to whoever was sent the code in their beta email. The code can be forwarded — that is a real and accepted cost. The beta is free, so the downside of a forwarded code is an extra unpaid account, not lost revenue; the alternatives each cost more than that is worth (see below).

## Why the obvious approach is wrong

**1. Do not gate account creation with a middleware over every path that creates a `User`.** That is the intuitive reading of "close registration", and it breaks the beta on day one: it catches `POST /api/organizations/invitations/accept`, which is the path a paying customer's colleague uses to join. The gate belongs in the `/register` handler alone. Invitation acceptance stays open in every mode, unchanged — a person holding a single-use, expiring, address-bound token has already been admitted by a customer.

**2. Do not build a platform-admin toggle.** The tempting version is a settings row and an endpoint that flips it. There is no platform administrator in this product — `Membership.role` is scoped to one organization and nothing sits above it (`backend/src/middleware/membership.ts`), so this would mean inventing a superuser and a new privileged surface, to be used approximately twice. An environment variable plus a container restart *is* a switch somebody can throw: no rebuild, no commit, no PR.

**3. Do not default the flag to the closed state, and do not default it to open either.** `envBool`'s contract (`backend/src/config/env.ts:9`) requires every caller to pick the safe direction as its default, and here neither direction is safe: defaulting closed breaks every developer environment and the four suites that register users, and defaulting open means a production deploy that omits the variable silently runs an open beta. Use the shape [`features/0028`](0028-boot-time-configuration-validation.md) already built for exactly this: **the value defaults to `open`, and `validateEnv` requires it to be set explicitly when `isStrict(env)`** (`backend/src/config/validate-env.ts:70`). Development and test are unaffected; a production deploy that forgets it refuses to boot with a message naming it. This is the same allowlist-on-`NODE_ENV` argument as `DEV_PLAN_KEY`, and it must import `isStrict` rather than write a second copy.

**4. `app.ts` calls `dotenv.config()` and every backend spec imports it.** A developer running the beta configuration locally would otherwise break `backend/tests/auth.spec.ts`, `backend/tests/rate-limit.spec.ts`, and the three integration specs that register users. `backend/vitest.config.ts` already pins six variables against precisely this bleed, with the comment *"which it did, and four of them failed before this line existed"*. `REGISTRATION_MODE` must be pinned to `open` in `backend/vitest.config.ts` **and** `backend/vitest.integration.config.ts`, and the E2E environment must set it too (`e2e/helpers.ts` registers).

**5. A `403` here is not a `402`, and neither is a `400`.** The repository's codes are settled: `402` means a plan limit, `403` means the caller may not do this. Closed registration is the platform refusing, so it is `403`. Do not reuse the `400 'Email already registered'` branch for it — collapsing the two would let anyone probe which addresses exist.

**6. Compare the code in constant time, and never log it.** It is a shared secret arriving in a request body. Use `crypto.timingSafeEqual` over SHA-256 digests of both sides (equal-length inputs; `timingSafeEqual` throws otherwise), the same reasoning `backend/src/services/api-key.ts` uses for hashing rather than comparing directly. `registerRateLimit` already limits this path per IP, which is what bounds guessing.

## Goal

Checkable when the work is done:

1. `REGISTRATION_MODE` is read in one module and is either `open` or `invite_only`. An unrecognised value is a boot failure, not a fallback — the same refusal `services/pdf-storage.ts` makes for an unknown driver.
2. With `REGISTRATION_MODE` unset or `open`, `POST /api/auth/register` behaves exactly as it does today, including when a `code` is supplied and wrong. Every existing auth, rate-limit and integration test passes unchanged.
3. With `REGISTRATION_MODE=invite_only`, `POST /api/auth/register` answers `403` when the body carries no `code`, and `403` when the `code` does not match `REGISTRATION_CODE`. No user, organization or membership row is created in either case.
4. With `REGISTRATION_MODE=invite_only` and a matching `code`, registration succeeds and produces exactly what it produces today: user, personal organization, owner membership, session.
5. `POST /api/organizations/invitations/accept` is **unchanged and unaffected in every mode** — asserted by an integration test that accepts an invitation with `REGISTRATION_MODE=invite_only` set.
6. `REGISTRATION_MODE=invite_only` with `REGISTRATION_CODE` unset or shorter than 16 characters is a boot failure in strict environments, reported by `validateEnv` alongside every other problem. A mode that closes registration with no way back in is the one configuration that must not start.
7. `GET /api/auth/registration` is unauthenticated and returns `{ "mode": "open" | "invite_only" }` and nothing else — no code, no hint, no environment detail.
8. `RegisterView.vue` reads that endpoint on mount. In `invite_only` it shows an "Invitation code" field and explains the beta; in `open` it renders exactly as today, with no code field. A `403` from the API is rendered as its message, not as a generic failure.
9. `REGISTRATION_MODE` and `REGISTRATION_CODE` are in `KNOWN_VARIABLES`, so `backend/tests/config-coverage.spec.ts` passes.
10. Turning the beta off is documented as one operator action in [08-operations](../docs/sot/08-operations.md): set `REGISTRATION_MODE=open`, restart the API. No worker restart is needed — the worker never registers anybody.

## Out of scope

- **Account-level lockout on repeated failed logins** (P1, S10). A closed registration is not a login control and this changes nothing about credential stuffing. Still filed.
- **Email delivery** (C3). The code reaches customers however the owner sends the beta email today; nothing in this repository sends mail.
- **Per-person beta invitations with their own organization** — the third admission option, an `Invitation.organizationId` that may be null. Considered and rejected for now: it is a migration on a table in the cascade map plus SPA work, for a mechanism that is retired one week after it ships. **File it in `docs/BACKLOG.md` under P3** as the follow-up if a second, larger cohort ever needs per-person revocable admission.
- **Rate-limiting the new `GET /api/auth/registration`.** It reads no database, takes no input and returns one enum. Do not add a limiter; do record the decision in [07-security](../docs/sot/07-security-and-privacy.md) so the next reviewer does not have to re-derive it.
- **Anything in `feature/0031-production-deployment`.** That branch is in flight in a sibling worktree and owns `compose.production.yml`, `deploy/nginx.conf`, `.env.deploy.example`, `Dockerfile.backend`, `Dockerfile.frontend`, `backend/src/routes/health.ts` and `backend/src/services/readiness.ts`. **Do not edit any of those files.** The two new variables must reach the deployment template, but that is a one-line addition made *after* 0031 merges — record it in this file's Outcome as a follow-up rather than editing a file the other branch is rewriting.

## Execution prompt

> Read first, in this order: `backend/src/routes/auth.ts` (the `POST /register` handler at `:63`), `backend/src/routes/organizations.ts:498` (the invitation-accept handler — the path that must keep working), `backend/src/config/validate-env.ts` (`isStrict`, `KNOWN_VARIABLES`, `validateEnv`), `backend/src/config/env.ts`, `backend/vitest.config.ts` (why variables are pinned there), and `frontend/src/views/RegisterView.vue` with `frontend/src/components/auth/RegisterForm.vue` and `frontend/src/services/auth.ts`.
>
> Apply the `backend-endpoint-pattern` skill for the route work and `frontend-state-pattern` for the SPA work. There is **no schema change** in this feature — do not open `prisma/schema.prisma`.
>
> **Write the failing tests first.** Add them to `backend/tests/auth.spec.ts`, run them against the unchanged code, and confirm they fail before writing the implementation: `invite_only` with no code is `403`; `invite_only` with a wrong code is `403`; `invite_only` with the right code succeeds; `open` ignores a supplied code. A test written after the change proves nothing about whether it catches the regression.
>
> **Build, in this order:**
> 1. `backend/src/config/registration.ts` — the only module that reads `REGISTRATION_MODE` and `REGISTRATION_CODE`. Export `registrationMode()` and `codeMatches(supplied: string | undefined): boolean`, which hashes both sides with SHA-256 and compares with `crypto.timingSafeEqual`. An unrecognised mode throws at first read, with a message naming the accepted values. Nothing else in `src/` may read either variable — that is the property `config-coverage.spec.ts` and the reviewer will check.
> 2. `backend/src/config/validate-env.ts` — add both names to `KNOWN_VARIABLES`, and add rules to `validateEnv`: `REGISTRATION_MODE` required when `isStrict(env)`; an unrecognised value is a problem in every environment; `REGISTRATION_CODE` required and at least 16 characters when the mode is `invite_only`. Messages follow the voice already in that file — name the variable, what was expected, and what goes wrong if it is left as it is. Extend `backend/tests/config-coverage.spec.ts` only if it fails.
> 3. `backend/src/routes/auth.ts` — add `code: z.string().optional()` to `registerSchema`, and after the schema parse but **before** the `findUnique` on email, refuse with `new AppError(403, …)` when the mode is `invite_only` and `codeMatches` is false. Refusing before the email lookup is deliberate: an unadmitted caller must not be able to probe which addresses are registered. Then add `GET /registration` to the same router, unauthenticated, returning `{ mode: registrationMode() }` and nothing more.
> 4. `frontend/src/services/auth.ts` — a `getRegistrationMode()` calling `GET /auth/registration`, and a `code` argument threaded through `register`. Follow the one-service-per-resource shape already in that file.
> 5. `frontend/src/views/RegisterView.vue` and `frontend/src/components/auth/RegisterForm.vue` — fetch the mode on mount; in `invite_only` render the code field and a short line saying the beta is invitation-only; in `open` render exactly what renders today. If the mode request fails, render the form **with** the code field as optional rather than blocking signup — a failed GET must not become an outage on the signup screen. Surface the API's `403` message verbatim.
> 6. Pin `REGISTRATION_MODE: 'open'` in `backend/vitest.config.ts` and `backend/vitest.integration.config.ts`, in the same block and with the same style of comment as `DEV_PLAN_KEY`. Set it for the E2E run too — check how `e2e/helpers.ts` and the Playwright config get their environment before choosing where.
> 7. `backend/tests/integration/` — one test that accepts an invitation end to end with `REGISTRATION_MODE=invite_only`, proving goal 5. Use the `test-author` agent if the existing invitation fixtures are not obvious.
>
> **Do not touch** any file listed under "Out of scope" — `feature/0031-production-deployment` owns them in another worktree and a conflict there is expensive. Do not add a limiter to the new GET. Do not change `config/env.ts`'s contract. Do not change `POST /api/organizations/invitations/accept`.
>
> **Verify:** `npm run test:backend`, `npm run test:integration`, `npm run test:frontend`, `npm run test:e2e`, `cd backend && npx tsc --noEmit`, and `npm run build --workspace=frontend`. Report the real output; if a suite fails, show it rather than describing it.
>
> **On the way out:** run `api-contract-guard` for the changed and added endpoints and update [06-api-reference](../docs/sot/06-api-reference.md); run `sot-sync` for [07-security](../docs/sot/07-security-and-privacy.md) (why the GET carries no limiter, why the refusal precedes the email lookup, why invitation acceptance is exempt), [08-operations](../docs/sot/08-operations.md) (both variables, and the one-action way back), and [10-saas-roadmap](../docs/sot/10-saas-roadmap.md) (strike D7 in the "What comes next" table **and** in its §D paragraph, pointing both at this spec). Note that D7 has **no row in `docs/BACKLOG.md`** — it exists only in the roadmap shortlist, so there is nothing to remove there; the only backlog edit is *adding* the org-less-invitation follow-up under P3. Set this file to `**Status:** done` with an Outcome that records the `.env.deploy.example` line still owed once 0031 merges. Run `ship-checklist` before the PR.

## Outcome

Built as specified. `backend/src/config/registration.ts` is the only module that reads either variable; the gate is four lines in the `POST /register` handler, before the email lookup.

**Verified:** backend 24 files / 307 tests, integration 25 files / 250 tests (10 skipped — the Redis-gated specs, unchanged), frontend 51 files / 422 tests, E2E 53 tests, `tsc --noEmit` clean, frontend build clean. The seven new backend route tests were run against the unchanged handler first and seen to fail (7 failed / 12 passed) before any implementation existed.

Beyond the suites, all three boot refusals were confirmed in a real built process rather than only through `validateEnv`: a strict environment with no `REGISTRATION_MODE` exits `1`, `invite_only` with no `REGISTRATION_CODE` exits `1`, and an unrecognised mode exits `1` on the **worker** as well as the API.

**Two deviations from the execution prompt, both because the code was not shaped the way the prompt assumed:**

1. **The mode fetch went into `RegisterForm.vue`, not `RegisterView.vue`.** The view is a nine-line wrapper that renders `<RegisterForm />` inside `AuthLayout`; the form owns every field, the validation and the submit. Putting the fetch in the view would have meant a prop threaded through for no reason.
2. **`docs/BACKLOG.md` lost no row**, as the spec anticipated: D7 lived only in the roadmap shortlist. The only backlog edit is the added P3 follow-up.

**One thing the spec did not anticipate.** [07-security §"Rules for new code"](../docs/sot/07-security-and-privacy.md) asserted *"There is exactly one endpoint without one"* — a rate limiter — naming the Stripe webhook. `GET /api/auth/registration` makes two, so that sentence was updated rather than left to become false, and the exemption is argued to the same standard the rule demands.

`backend/.env.example` documents both variables — it is the committed template for a *developer's* `.env` and belongs to this feature, unlike the deployment template below.

**Still owed, and deliberately not done here:** `REGISTRATION_MODE` and `REGISTRATION_CODE` must also be added to `.env.deploy.example`, which belongs to `feature/0031-production-deployment` and was untouched under this spec's scope fence. It is a two-line addition once 0031 merges; without it the first production deploy refuses to boot with the message this feature added — which is the designed failure, but only useful if the template names the variables.
