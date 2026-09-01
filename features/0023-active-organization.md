# 0023 — The active organization, without which belonging to two is broken

**Status:** backlog
**Priority:** P1 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md) — *A user who belongs to two organizations reads from both and writes to one*)
**Related:** [03-domain-model](../docs/sot/03-domain-model.md) · [04-backend-patterns §9](../docs/sot/04-backend-patterns.md) · [05-frontend-patterns §8](../docs/sot/05-frontend-patterns.md) · [07-security-and-privacy](../docs/sot/07-security-and-privacy.md) · [10-saas-roadmap §what comes next](../docs/sot/10-saas-roadmap.md#what-comes-next) · [`features/0009`](0009-organizations-own-resources.md) · [`features/0010`](0010-member-invitations-and-role-enforcement.md)

## Context

This started as A2 — *"an endpoint that returns the organization, then the switcher and renaming"*, described in the roadmap as **"a small endpoint two screens are waiting on"**. Reading the code before writing the spec turned it into something else, and the something else is a live defect in the B2B flow [`features/0010`](0010-member-invitations-and-role-enforcement.md) shipped.

**Nothing in this codebase decides which organization a request is acting in.** Two different rules answer that question and they disagree:

- **Reads span every organization the caller belongs to.** `memberOfCallerOrganization` in `backend/src/middleware/formOwnership.ts:18` is `{ organization: { memberships: { some: { userId } } } }` — *some*, not *the current one* — and `callerCanReachForm` is what `GET /api/forms` and `verifyFormOwnership` use.
- **Writes and entitlements go to the oldest membership.** `requireMembership` in `backend/src/middleware/membership.ts` takes `findFirst({ orderBy: { createdAt: 'asc' } })`, and its own comment says why that was acceptable: *"Every account belongs to exactly one organization today, so there is nothing to choose between."*

**That premise is false, and has been since invitations shipped.** `joinOrganization` (`backend/src/routes/organizations.ts`) adds a membership to an existing account; the register-and-join path beside it deliberately avoids creating a second organization and says so — *"giving them a second one would put them in two — which `requireMembership` is not built for and would resolve arbitrarily"* — but a person who already had an account is exactly the case that ends up in two.

**Measured, not inferred.** A throwaway integration test against a real database: user registers (personal organization, Free), is invited to a Team organization, accepts while signed in. Afterwards:

| | What happens |
|---|---|
| Memberships | 2 |
| `GET /api/forms` | The **inviting company's** forms — merged with their own, nothing saying which is which |
| `POST /api/forms` | Lands in **their personal organization**. The company's owner never sees it |
| `GET /api/organizations/entitlements` | **Free** — their personal plan, not the company's Team |

So a colleague invited into a paid organization browses its forms, creates work that silently goes somewhere else, and hits Free's limits (one published form, 50 responses a month) inside a Team account whose seat was spent on them. Nothing errors. Nothing warns.

**Why the existing tests did not catch it.** `backend/tests/integration/invitations.spec.ts` has *"joins the organization when signed in as the invited address"*, and its `existingUser()` helper builds a user with `prisma.user.create` **and no organization of their own** — so the invitee ends with exactly one membership and the case never arises. The test that proves a new member can read the organization's forms (*"after joining"*) uses the register-and-join path, which is the one that was careful. Both tests are correct about what they assert; neither asserts this.

**No prior attempt.** `git log --all` has no branch and no revert touching an active-organization concept.

## Why the obvious approach is wrong

### 1. Making reads match writes is not the fix — both rules are wrong

The tempting one-liner is to change `memberOfCallerOrganization` to use the oldest membership too, so reads and writes agree. That makes the product *consistent* and **still broken**: the invited colleague would then see their own empty personal organization, the invitation would appear to have done nothing at all, and the customer's support question changes from "where did my form go?" to "why did nothing happen?".

The thing that is missing is not consistency between two rules. It is that **there is no rule** — no answer to *which organization is this request acting in*, only two accidents of implementation. That answer has to exist before either call site can be correct, and once it exists both become one line.

### 2. The active organization must not go in the JWT, and the reason is already written down

`formOwnership.ts` says it: *"Membership is resolved from the database on every request rather than carried in the JWT. That is deliberate: access tokens live 15 minutes and cannot be revoked, so a membership claim baked into one would keep working for 15 minutes after someone was removed from an organization."*

An active-organization claim in the token has exactly that defect and one worse: it is an **authorization input** supplied by a bearer credential the server cannot withdraw. Whatever carries the choice, the server must re-check on every request that the caller still holds a live membership in it — and fall back rather than trust it.

### 3. A header alone repeats the bug it is fixing

`X-Organization-Id`, sent by the SPA and validated per request, is the stateless option and it is genuinely attractive: two tabs could sit in two organizations. The problem is the failure mode. Every existing client call site would have to send it, and a call site that forgets — a service written next month, a `curl`, the editor's save — silently acts in whatever the fallback is. That is precisely today's defect with a new name, and it would be reintroduced one endpoint at a time by people who did not read this file.

**Use `User.activeOrganizationId` instead**: a nullable column, switched by an endpoint, read by `requireMembership`. Every route that exists keeps working with no client change, correctness lives in one function, and a client that knows nothing about organizations still acts in a defined one.

**The trade, so nobody discovers it as a surprise:** the choice is per *account*, not per tab, so two browser tabs cannot sit in two organizations, and switching in one changes the other on its next request. That is the same behaviour Linear and Notion have; it is worth naming in the PR, not hiding.

### 4. The fallback is the whole safety argument, and it must be a query, not a memory

`activeOrganizationId` is a **cache of a choice, never a grant**. On every request:

- if it names an organization the caller still has a live `Membership` in, that is the active one;
- otherwise it is ignored and the oldest membership is used, exactly as today.

Both halves matter. The first is what makes removal effective immediately: a member removed from an organization stops acting in it on the very next request, with no session to expire and no cleanup job. The second is what stops a stale or hand-edited column becoming access — the column can never *grant* anything, it can only *select* among memberships that already exist. A single `findFirst` on `Membership` scoped by both ids answers it, which is the same one query `requireMembership` already makes.

### 5. Scoping reads to the active organization is a behaviour change, and it is the point

After this, a two-organization user sees one organization's forms at a time rather than a merged list. That is not a regression to be softened with a "show all" toggle: a merged list across tenants is what made the bug invisible, and every count, meter and limit in the product is per organization. Say it plainly in the SoT.

Note the one place this must **not** reach: `Invitation` acceptance resolves its organization from the invitation, never from the caller's active one, and `assertNotLastOwner` counts owners in the organization it is given. Neither takes an active organization as input and neither should learn to.

### 6. The switcher is not optional dressing here

Without it, this change strands people: a user in two organizations would be pinned to whichever the fallback picks, with no way to reach the other. The switcher is what makes the fix usable, which is why it is in the same spec rather than a follow-up — a rare case where a UI control and a backend rule genuinely share one reason to change.

## Goal

Checkable when the work is done:

1. A migration adds `User.activeOrganizationId`, nullable, `onDelete: SetNull`, recorded in the cascade map in [03-domain-model](../docs/sot/03-domain-model.md).
2. `requireMembership` returns the membership named by `activeOrganizationId` when the caller still has one there, and the oldest membership otherwise. It is the only place that decides.
3. `callerCanReachForm` scopes to the **active organization**, not to `memberships: { some: … }`. A user in two organizations sees one organization's forms at a time.
4. `GET /api/organizations` returns the caller's organizations — `{ id, name, slug, role }` each — and which one is active. Any member may call it.
5. `POST /api/organizations/active` (or equivalent) switches, accepts an organization id, answers `404` when the caller has no membership there, and persists.
6. A user who registers, is invited to another organization and accepts while signed in: is switched to the inviting organization on acceptance, sees its forms, creates forms **into it**, and is metered against **its** plan. An integration test asserts all four, and fails against `origin/develop`.
7. Removing a member takes effect on their next request even while their `activeOrganizationId` still names that organization.
8. The SPA sidebar has the organization switcher from the canvas, showing the active organization's name; switching reloads the forms, the plan card and the members screen.
9. No route, service or component reads `activeOrganizationId` other than `requireMembership` and the switch endpoint. `grep -rn activeOrganizationId backend/src` names two files.
10. `npm run test:frontend`, `npm run test:backend`, `npm run test:integration`, `npm run test:e2e`, `npm run build --workspace=frontend` and `cd backend && npx tsc --noEmit` all pass.

## Out of scope

- **Renaming an organization.** The endpoint this adds is where it will live, and `SettingsView.vue` names it as blocked — but it is a separate unit of undo with its own role question (owner only, or admin too?). Keep the backlog row and let it be the next small thing.
- **Creating a second organization from the product.** Today an organization comes from registering or from being invited. A *Create organization* control is a different feature with a billing question attached — a new organization is a new `planKey`, therefore a new free tier per click.
- **Leaving an organization.** Adjacent and not required: `assertNotLastOwner` covers the dangerous half already, and nothing today lets a member remove themselves.
- **Per-tab organizations.** Explicitly rejected in trap 3.
- **`Membership.role` semantics on the canvas** (a member seeing "only the forms they created"). Still a separate filed row, and this change must not quietly implement it: after this, scoping is by organization and nothing else.
- **Any change to invitation acceptance authorization.** The one addition permitted is switching the accepter's active organization to the one they just joined (criterion 6). Which organization an invitation belongs to is never the caller's active one.

## Execution prompt

> Give this application an **active organization**, then the switcher that makes it usable. Apply `prisma-schema-migration` for the column, `backend-endpoint-pattern` for the two endpoints, `frontend-state-pattern` for the store, and `api-contract-guard` before documenting.
>
> **Write the failing test first.** In `backend/tests/integration/invitations.spec.ts`, a test where the invitee is built with the `createUser` helper from `./helpers.js` — a **registered** user with their own organization — rather than the local `existingUser()` helper that gives them none. Assert the four things in criterion 6. Run it against the current code and watch it fail: it will show forms merged across both organizations, a created form landing in the personal one, and `entitlements` reporting `free` while the inviting organization is on `team`. That failure is the feature. Do not start the fix until you have seen it.
>
> **Read first.** `backend/src/middleware/membership.ts` (all of it — `requireMembership`'s comment states the assumption this breaks), `backend/src/middleware/formOwnership.ts:18-25` (the `some` that spans tenants, and the paragraph on why membership is not in the JWT), and the invitation acceptance handler in `backend/src/routes/organizations.ts` — both branches, and the comment in the register-and-join one that already saw this coming.
>
> **Schema.** One migration through `prisma migrate dev`, adding `activeOrganizationId` to `User` with a relation to `Organization` and `onDelete: SetNull`. It is nullable and stays nullable: `null` means *never chose*, which is every account today and is not a broken state.
>
> **Backend.** `requireMembership` becomes: if `activeOrganizationId` is set, look for a membership on `(userId, activeOrganizationId)` and return it if it exists; otherwise fall back to the oldest, unchanged. One extra query at most, and no route learns anything new. Then `callerCanReachForm` takes the active organization id and scopes on `organizationId`, which makes it `async` — follow the calls and keep the `404`-not-`403` rule at every one. `GET /api/organizations` lists the caller's organizations with their role and the active id; the switch endpoint verifies membership and writes the column. Set the accepter's active organization inside `joinOrganization`'s transaction, so accepting an invitation lands them where they were invited.
>
> **Frontend.** Extend `frontend/src/services/organization.ts` and `stores/organization.store.ts` — this is the store that already owns members and roles, and a second store for the same resource would be two answers to "which organization am I in". The switcher goes in `frontend/src/layouts/AppShell.vue`, where the canvas draws it, above the navigation. After a switch, everything on screen is about a different tenant: reload the forms, the plan and the members rather than leaving stale numbers under a new name. Render it only when the caller has more than one organization — a switcher with one entry is furniture.
>
> **Tests.** Integration is where this lives: the failing test above, plus one that a removed member stops acting in the organization on their next request even with the column still pointing there, one that switching to an organization the caller is not in answers `404`, and one that a stale `activeOrganizationId` (membership deleted underneath) falls back rather than granting. Check `backend/tests/integration/tenancy.spec.ts` still passes unchanged — it is the file that exists to catch exactly this class of bug, and if it does not move, ask whether it should have. Frontend: the service and store additions, and that the switcher does not render for one organization. E2E: `e2e/team.spec.ts` uses the register-and-join path and should be unaffected — confirm rather than assume.
>
> **Verify.** All four suites, both type checks, and the failing test now passing. Then by hand: register two accounts, invite the second from the first, accept while signed in, and confirm the switcher appears with both, that forms and the plan card change when it is used, and that a form created after switching belongs to the organization named in the switcher.
>
> **On the way out.** Run `sot-sync`. [03-domain-model](../docs/sot/03-domain-model.md) gains the column and its cascade; [04-backend-patterns §9](../docs/sot/04-backend-patterns.md) gains the active-organization rule and must state that `requireMembership` is the only thing that decides; [07-security-and-privacy](../docs/sot/07-security-and-privacy.md) records that the column selects among memberships and never grants one, and why the choice is not in the token; [06-api-reference](../docs/sot/06-api-reference.md) gains the two endpoints; [05-frontend-patterns §8](../docs/sot/05-frontend-patterns.md) loses the organization switcher from *what the canvas has that the app does not*. Remove the backlog rows this closes — the switcher row and the two-organization defect — and set this file to `**Status:** done` with an Outcome. Then `ship-checklist`.

## Outcome

*(filled in when the work is done)*
