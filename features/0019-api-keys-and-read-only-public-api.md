# 0019 — API keys, and a public API that is read-only on purpose

**Status:** in progress
**Priority:** P2 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md) — *Public API with per-organization API keys*)
**Branch:** `feature/0019-api-keys-and-read-only-public-api`
**Related:** [10-saas-roadmap §build order](../docs/sot/10-saas-roadmap.md#build-order) · [04-backend-patterns](../docs/sot/04-backend-patterns.md) · [06-api-reference](../docs/sot/06-api-reference.md) · [07-security-and-privacy](../docs/sot/07-security-and-privacy.md) · [03-domain-model](../docs/sot/03-domain-model.md) · [`features/0012`](0012-plan-catalogue-and-entitlements.md) · [`features/0018`](0018-shared-rate-limit-store.md)

## Context

**Step 10 of the [build order](../docs/sot/10-saas-roadmap.md#build-order), and the first half of it.** Steps 0–9 are closed. The backlog row says the prerequisite was stable field ids — which [`features/0001`](0001-stable-field-ids-and-safe-bulk-save.md) delivered, and which matters because an integration holds references to fields that must not change under it — and notes that `Plan.hasApiAccess` has sat in the catalogue since [`features/0012`](0012-plan-catalogue-and-entitlements.md) with nothing reading it (`backend/src/services/plans.ts:91`).

Two things that landed since make this the right moment. [`features/0018`](0018-shared-rate-limit-store.md) gave the service a shared rate-limit store, without which a documented API limit would have been a number multiplied by replica count. And [`features/0017`](0017-job-queue-for-pdf-embedding.md) brought the queue that outbound webhooks will need — **which is the other half of step 10 and is not in this feature.**

This is the first surface where somebody drives the product without a browser. Everything the SPA calls today is unversioned, undocumented outside [06-api-reference](../docs/sot/06-api-reference.md) (which describes it for *us*), and free to change in any release. That stops being true for whatever this feature publishes, so what it publishes is deliberately small.

**No prior attempt.** `git log --all` has nothing on API keys and no revert.

## Why the obvious approach is wrong

### 1. Every authorization path in this codebase resolves a **user**, and an API key does not have one

This is the trap, and it is not obvious until you read `backend/src/middleware/formOwnership.ts`:

```ts
const memberOfCallerOrganization = (userId: string | undefined) => ({
  organization: { memberships: { some: { userId } } }
})
```

Tenancy is a `where` fragment built from `req.userId` ([04-backend-patterns §9](../docs/sot/04-backend-patterns.md)), and `requireMembership` in `middleware/membership.ts` turns that user into an organization and a role. **An API key belongs to an organization and to no person**, so every one of those functions is the wrong shape for it.

The two tempting shortcuts are both wrong:

- **Give the key a user id** — the creator's, or the organization's owner's — so the existing middleware "just works". It grants the key one specific human's rights, and it breaks the moment that person is removed from the organization: a production integration stops working because somebody left, with a `404` that names a form rather than the real cause. It also makes `Membership.role` silently apply to a machine, so revoking an admin's role changes what a key can do.
- **Loosen `callerCanReachForm` to accept either a user or an organization.** It is two lines and it changes the authorization input of *every* authenticated route in the product — the highest-blast-radius edit available in this repository, made for the benefit of endpoints that do not exist yet.

**The shape that works is a separate router.** `routes/v1/` mounted at `/api/v1`, authenticated by key, scoping every query on `organizationId` directly, reusing the *services* (`services/csv-exporter.ts`, `services/entitlements.ts`, Prisma) rather than the session middleware. The existing routes are not touched at all. That is also what keeps the two contracts separate — see trap 4.

### 2. An API key is not a JWT, and it must not be stored the way a password is either

A key that cannot be revoked is not a key, so **the session token machinery is exactly the wrong thing to reuse**: `services/session-cookie.ts` and the access token are stateless by design, and statelessness is the property this must not have. A key is a database row that can be deleted; that is the entire point.

Nor is it a password. bcrypt is used in exactly one place in this backend — `routes/auth.ts`, on human-chosen passwords — and reaching for it here is the other way to get this wrong: **an API key is presented on every single request**, and a bcrypt verification is tens of milliseconds of CPU *by design*, which turns the API's own rate limit into a CPU sink an attacker drives with invalid keys.

`services/refresh-token.ts` already made this decision and is the precedent to follow: it stores a SHA-256 of a 32-byte CSPRNG token, and the note on `RefreshToken` in `schema.prisma` says a fast hash is the right choice *there and nowhere else in this codebase* — this feature is the second place it is right, for the same reason. There is nothing to brute force in 256 bits of randomness; the hash exists so that a database leak is not a set of live credentials. Compare in constant time (`crypto.timingSafeEqual`).

The row needs a **lookup key that is not the secret**: store a short public prefix, index it, find the row by prefix, then compare the hash. Scanning every key row and hashing each one is the alternative, and it gets slower as customers are added.

Three properties that are easy to leave out and are not negotiable:

- **Shown once.** The response that creates a key is the only place the secret ever appears. There is no "reveal" endpoint, because a stored plaintext key is a stored password.
- **Never logged.** `middleware/errorHandler.ts` logs stack traces for 5xx; make sure no path puts the header value in a log line or an error message. The same rule the refresh cookie already follows.
- **Revocation is immediate**, because it is a row read per request. Do not add a cache "for performance" in this feature.

### 3. Per-IP rate limiting is wrong for an API, and this is the first place that matters

[07-security rule 2](../docs/sot/07-security-and-privacy.md) requires every new public endpoint to ship with a limiter or a written argument. The limiters that exist are keyed on `req.ip`, which is right for a browser and wrong here: one customer's integration is one server address, so a per-IP limit is a per-customer limit by accident, and a customer behind NAT shares a limit with strangers.

**The limiter for `/api/v1` keys on the API key's id**, which is the identity that actually corresponds to a quota. `middleware/rateLimit.ts` after [`features/0018`](0018-shared-rate-limit-store.md) is already a named catalogue with a shared store, so this is a sixth entry with its own `keyGenerator` — and the store is shared, so the published number is the real number rather than one multiplied by replica count. Note the interaction with an unauthenticated request: a request with **no** key, or an unknown one, has no id to key on and must fall back to the IP, or an attacker gets an unlimited budget by simply not authenticating.

### 4. Publishing `/api/v1` is a promise, and the SPA's `/api/*` must not accidentally become one too

Everything under `/api/*` today exists to serve `frontend/`, and [06-api-reference](../docs/sot/06-api-reference.md) documents it for this repository's own benefit. Once a customer integrates, the endpoints they use cannot change shape without breaking them — and nothing in this codebase distinguishes the two audiences.

So the split has to be explicit, in code and in the documentation: **`/api/v1/**` is the contract; everything else is internal and may change in any release.** Two consequences to hold on to. A v1 response is **not** the internal serialisation of a Prisma model — return an explicitly built object, so adding a column does not silently publish it (`Form.createdByUserId` is provenance, `Organization.planKey` is billing state, neither belongs in a customer's integration). And the SPA must not be pointed at `/api/v1` "for consistency": it would then be a customer of the frozen contract, and every internal change would need a version bump.

### 5. `hasApiAccess` is Team-only, and that is a product decision this feature will make visible

`backend/src/services/plans.ts` has `hasApiAccess: false` for Free and Pro and `true` for Team. Wiring the entitlement therefore means **a Pro customer gets a `402` when they try to create a key** — correct per the catalogue, and worth confirming with the repository owner rather than discovering after launch, because it is the first feature that makes Pro visibly less capable rather than smaller.

Follow the rules [`features/0012`](0012-plan-catalogue-and-entitlements.md) established, which have not changed: the check is an **explicit call inside the handler**, never middleware; `402` means a plan limit and `403` means a permission failure and they are never collapsed. Note also that `DEV_PLAN_KEY` grants it in development, so a local run will not exercise the `402` unless it is set deliberately.

### 6. Responses carry other people's personal data, and an API key is a new way out of the building

`GET /forms/:id/responses` returns respondent answers — free text a form author collected from members of the public ([07-security](../docs/sot/07-security-and-privacy.md), data inventory). A key that reads them is a **new export path for personal data**, held by a bearer credential that may live in a customer's CI system for a year.

Nothing about that blocks the feature, and it changes two things that must be done rather than assumed: the data inventory gains a row for "responses, readable by API key", and keys need `lastUsedAt` so a customer (and this project) can tell a live credential from a forgotten one. Expiry is **not** required by this feature, but the column should exist if adding it later means a migration on a hot table.

## Goal

**The key**

1. `ApiKey` is a table: organization, name, public prefix (unique, indexed), hash of the secret, `createdByUserId` as provenance only, `lastUsedAt`, `revokedAt`. The cascade is decided against the map in [03-domain-model](../docs/sot/03-domain-model.md) and written into it.
2. `POST /api/organizations/api-keys` (session-authenticated, `requireRole` owner or admin, `assertHasApiAccess` → `402`) returns the secret **once**. `GET` lists keys without secrets; `DELETE`/revoke takes effect on the next request, proven by a test.
3. The secret is never stored in plaintext, never logged, and verification is constant-time and cheap enough to run per request (no bcrypt — see trap 2).

**The API**

4. `/api/v1` is a separate router authenticated only by API key. A session token does **not** authenticate it and a key does **not** authenticate `/api/*`; both are tested.
5. Read-only in this feature: list forms, read one form (with its live fields), list a form's responses with pagination, and the CSV export. Nothing that writes.
6. Every query is scoped by the key's `organizationId`. A key from another organization gets `404`, never `403` — the same rule as [04-backend-patterns §9](../docs/sot/04-backend-patterns.md), tested the way `tests/integration/tenancy.spec.ts` tests the session routes.
7. Responses are explicitly built objects, not Prisma rows. No `createdByUserId`, no `planKey`, no internal ids that are not part of the contract.
8. A missing, malformed, unknown or revoked key answers `401`; a key whose organization has lost `hasApiAccess` answers `402`.

**Limits**

9. `/api/v1` carries its own limiter, keyed on the API key id, falling back to IP when there is no valid key. Documented in [06-api-reference](../docs/sot/06-api-reference.md) with its actual number.

**Documentation**

10. [06-api-reference](../docs/sot/06-api-reference.md) states plainly which surface is the contract and which is internal, and documents `/api/v1` as a customer would read it.
11. `lastUsedAt` is updated on use, cheaply — and the write must not turn every API read into a write on a hot row without a rate at which it is worth it (once per minute per key is enough; decide, and say why in the code).

**Must not change**

12. No existing route's authentication, authorization or response shape changes. `middleware/auth.ts`, `middleware/formOwnership.ts` and `middleware/membership.ts` keep resolving a user, untouched.
13. The SPA is not repointed at `/api/v1`.
14. All four suites pass unmodified except for additions.

## Out of scope

- **Outbound webhooks** — signed payloads, retries, a delivery log. Its own backlog row, and it wants the queue from [`features/0017`](0017-job-queue-for-pdf-embedding.md) plus a second job type. It is the other half of step 10 and it is a bigger feature than this one.
- **The SPA's `API keys` tab.** Drawn on the canvas and listed as unbuilt in [05-frontend-patterns §8](../docs/sot/05-frontend-patterns.md). Without it a customer cannot mint a key from the product — so this feature is API-only until that ships, and that must be said in the Outcome rather than discovered.
- **Write endpoints on `/api/v1`** — creating forms, editing fields, deleting responses. Each needs its own thinking about idempotency and about what a machine may destroy; hard rule 5 applies with more force to a caller that is a script.
- **OpenAPI/machine-readable schema**, SDKs, and a developer portal.
- **Per-key scopes or permissions.** One key reads everything its organization can read. Scopes are a real feature and belong after there is something to scope.
- **Key expiry and rotation UX.** The column may exist; the flow does not.

## Execution prompt

> Build API keys and a read-only `/api/v1`, the first half of build-order step 10. Read this whole spec first, then `backend/src/middleware/formOwnership.ts` and `middleware/membership.ts` — the reason this is a separate router and not a flag on the existing one is in there, and it is the decision the rest of the work hangs off.
>
> **Read first.**
>
> - `backend/src/middleware/formOwnership.ts`, `middleware/membership.ts`, `middleware/auth.ts` — how tenancy is resolved today, always from a user.
> - `backend/src/services/plans.ts` and `services/entitlements.ts` — `hasApiAccess`, and the rule that a limit check is an explicit call in the handler and `402` is not `403`.
> - `backend/src/middleware/rateLimit.ts` — the named-limiter catalogue and its shared store after [`features/0018`](0018-shared-rate-limit-store.md); the new limiter is an entry with its own `keyGenerator`.
> - `backend/src/services/refresh-token.ts` — how a revocable secret is already stored here (SHA-256 over a CSPRNG token), and the note on `RefreshToken` in `schema.prisma` about when a fast hash is the right choice.
> - `backend/tests/integration/tenancy.spec.ts` — the standard of proof for a tenancy boundary; `/api/v1` needs its own equivalent.
>
> **Apply the skills:** `prisma-schema-migration` for the table, `backend-endpoint-pattern` for the routes, `api-contract-guard` before documenting anything, then `sot-sync` and `ship-checklist`.
>
> ---
>
> **Step 1 — the table and the key service.** `ApiKey`, a migration, and `services/api-key.ts`: mint, hash, verify, revoke. Unit-test the crypto (a wrong secret with a right prefix fails; a revoked key fails; verification is constant-time in shape). Commit here.
>
> **Step 2 — the management endpoints** under the existing session-authenticated `routes/organizations.ts`, with `requireRole` and the `hasApiAccess` check. Test the `402`, the `403` and the shown-once behaviour.
>
> **Step 3 — the `/api/v1` router.** Key authentication, organization scoping, the read endpoints, explicitly built response bodies. **Write the cross-tenant test first** — a key from organization A asking for a form of organization B — and watch it fail against a router that has no scoping yet, so it is proven to be testing the boundary rather than a typo.
>
> **Step 4 — the limiter**, keyed on the key id with an IP fallback, and a test that an unauthenticated caller cannot spend an unlimited budget.
>
> **Do not** change any existing middleware, do not repoint the SPA, do not add write endpoints, and do not add a key cache.
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
> Then by hand: mint a key, call `/api/v1/forms` with it, revoke it, and confirm the next call is a `401` with no restart in between. With `DEV_PLAN_KEY=pro`, confirm minting answers `402`.
>
> **Before the PR:** run `saas-readiness-reviewer`. This adds a new authentication mechanism, a new export path for respondent personal data, and a new public surface — three of the six things it looks for.
>
> **Documentation exit, required:**
> - [`06-api-reference`](../docs/sot/06-api-reference.md): the contract-versus-internal split stated at the top, and `/api/v1` documented as a customer reads it, limiter included.
> - [`03-domain-model`](../docs/sot/03-domain-model.md): `ApiKey` and its cascade in the map.
> - [`07-security-and-privacy`](../docs/sot/07-security-and-privacy.md): a new bearer credential and its properties (hashed, shown once, revocable, `lastUsedAt`); the data inventory gains responses-readable-by-key; and the public-surface diagram gains `/api/v1`.
> - [`04-backend-patterns`](../docs/sot/04-backend-patterns.md): the second authentication mechanism, and why it is a separate router rather than a change to the tenancy fragment.
> - [`10-saas-roadmap`](../docs/sot/10-saas-roadmap.md): step 10 is **half** closed — say so precisely, and what webhooks still need.
> - [`docs/BACKLOG.md`](../docs/BACKLOG.md): close *Public API with per-organization API keys*. Leave *webhooks* open. Add rows for the SPA `API keys` tab, for write endpoints, and for per-key scopes.
> - `CLAUDE.md`: the current-state paragraph gains the second way to authenticate.
> - This file: `**Status:** done` and an **Outcome** — what shipped, the real test output, the failing-test-first evidence for the tenancy boundary, and the fact that no customer can mint a key until the SPA tab exists.

## Outcome

*(filled in when the work is finished)*
