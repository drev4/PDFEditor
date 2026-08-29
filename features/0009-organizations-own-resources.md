# 0009 — Organizations own resources, users belong to them

**Status:** done
**Priority:** P2 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md)) — step 4 of the [build order](../docs/sot/10-saas-roadmap.md#build-order), which is what makes it next
**Branch:** `feature/0009-organizations-own-resources`
**Related:** [`10-saas-roadmap`](../docs/sot/10-saas-roadmap.md) · [`03-domain-model`](../docs/sot/03-domain-model.md) · [`04-backend-patterns`](../docs/sot/04-backend-patterns.md) · [`06-api-reference`](../docs/sot/06-api-reference.md) · [`07-security-and-privacy`](../docs/sot/07-security-and-privacy.md)

## Context

Steps 0 to 3 of the build order are closed, and no **High** security finding is open. Step 4 is the structural change the roadmap has been pointing at since it was written: today `Form.userId` points at a `User` and every authorization decision is "does this row's `userId` equal the caller's". Target shape, and the reasoning for it, are in [10-saas-roadmap](../docs/sot/10-saas-roadmap.md#the-structural-decision-organizations-own-resources-users-do-not). **Do not restate that reasoning; read it.**

The reason it is next rather than later is cost, not value: it is the longest-lead schema change in the product, and every row added to `forms` and `responses` makes it more expensive. There is no revenue and no deployment yet, so it is as cheap now as it will ever be.

The surface is smaller than it sounds. Every ownership decision in the backend reads `Form.userId` in exactly **five** places:

| Site | What it does |
|---|---|
| `backend/src/middleware/formOwnership.ts:7` | `verifyFormOwnership` — the shared check, behind **8** call sites in `routes/forms.ts` and `routes/form-fields.ts` |
| `backend/src/routes/forms.ts:47` | `GET /api/forms` — the list |
| `backend/src/routes/forms.ts:82` | `POST /api/forms` — sets the owner on create |
| `backend/src/routes/forms.ts:142` | `GET /api/forms/:id` |
| `backend/src/routes/forms.ts:308` | `GET /api/forms/:id/responses/export` |

Plus `routes/forms.ts:256`, which destructures `userId` off the public form so it never reaches an anonymous respondent, and `frontend/src/services/forms.ts:34`, which declares `userId: string` on the `Form` type.

**A B2C account is an organization with one member**, created at signup. There is no second code path and no "personal account" concept.

## Why the obvious approach is wrong

**1. Do not follow the roadmap's five-step deploy sequence as five merges.**

[10-saas-roadmap](../docs/sot/10-saas-roadmap.md#migration-path-done) sequences this as five independently deployable steps: add the tables, backfill, add a nullable `Form.organizationId`, repoint the reads, make it required. That sequencing exists to keep a **running system with live customer data** working during a rolling deploy where old and new code overlap.

There is no staging, no production and no customer data ([08-operations](../docs/sot/08-operations.md)). Spreading this over five merges buys nothing and costs something specific: the schema sits with a **nullable tenancy column that nothing enforces**, possibly for weeks, and a nullable `organizationId` is exactly the kind of column that becomes permanently nullable because someone is unsure whether it is safe to tighten. Do it as **one branch, in that order**, ending with the column `NOT NULL`. The ordering still matters — the backfill must run before the column is required, and you must see it work — but it is one migration sequence, not five PRs.

If real data ever exists before this ships, this paragraph is wrong and the five-step sequence is right. Check before assuming.

**2. `Membership` is not optional, and "organizationId on User" is not a shortcut.**

The tempting simplification is that an organization is a user under another name, so `User.organizationId` would do. That gives exactly one organization per user forever, and the first customer who wants a colleague to see their forms needs this same migration again — against data that is no longer small. The join table **is** the feature. Build it now even though every organization will have exactly one member on the day this merges.

**3. Do not put `organizationId` in the JWT.**

It is the obvious optimisation — it saves a lookup per request — and [`features/0008`](0008-session-hardening.md) makes it wrong. Access tokens are valid for 15 minutes and **cannot be revoked** ([07-security](../docs/sot/07-security-and-privacy.md#the-session-model)). An organization claim baked into one means that removing someone from an organization, or changing their role, does not take effect for up to 15 minutes — a removed member keeps reading and writing that organization's forms with a token that is still perfectly valid. Resolve membership from the database per request. If that ever shows up in a profile, cache it deliberately with a stated staleness window; do not inherit one by accident from the token lifetime.

**4. This change silently alters what deleting a user destroys — check it before you write the cascade.**

Today `Form.user → User` is `onDelete: Cascade`: deleting a user deletes their forms, fields and every response ever collected. That is currently only reachable from the database, because no account-deletion endpoint exists — but the cascade map in [03-domain-model](../docs/sot/03-domain-model.md#cascade-map) is the thing this repository takes most seriously, and this change rewrites it.

After the move, forms belong to an organization. Deleting a **user** must no longer destroy forms that their organization still owns and that other members may depend on. Deleting an **organization** destroying its forms and responses is defensible, but it is a new and much larger blast radius than anything that exists today, and it must be a deliberate decision written into the PR description, not a default. Answer the cascade-map question in writing for all three new relations before writing them: `Membership → User`, `Membership → Organization`, `Form → Organization`.

**5. Ownership failures must keep returning `404`, not `403`.**

`verifyFormOwnership` returns `404 Form not found` for a form that exists but belongs to someone else, deliberately: `403` confirms the row exists and turns the endpoint into an existence oracle. The membership-based check must preserve that. It is easy to lose while rewriting the query, and no existing test asserts the distinction — write one.

## Goal

1. `Organization` and `Membership` exist, with `role: owner | admin | member`, and `Membership` unique on `(organizationId, userId)`.
2. Registration creates a personal `Organization` and an `owner` `Membership` **in the same transaction** as the `User`. A failure at any point leaves no half-built account.
3. Every existing `User` has a personal organization and an `owner` membership, created by a data migration that is run and seen to work against a database that already holds users and forms.
4. `Form.organizationId` is **`NOT NULL`** at the end of this branch, indexed, and every form is attached to the organization of its original owner.
5. `Form.userId` is retained as the **creator**, renamed to make that unambiguous, and is no longer read by any authorization decision. `grep -rn 'userId: req.userId' backend/src` returns nothing.
6. Authorization is membership-based: a caller may act on a form when a `Membership` links them to that form's organization. Ownership failures still answer **`404`**, with a test asserting it.
7. No endpoint gains or loses a behaviour a client can see. `GET /api/forms` still returns the caller's forms; the public form endpoint still leaks no owner identity.
8. Role semantics are **stored but not yet enforced** — every member is effectively an admin for now. This is written down rather than implied, and the enforcement is a separate backlog row.
9. A database-backed test proves a member of organization A cannot read, edit or delete a form of organization B.
10. All four suites green: `npm run test:backend`, `npm run test:integration`, `npm run test:frontend`, `npm run test:e2e`, plus `npx tsc --noEmit` in `backend/` and `npm run build --workspace=frontend`.

## Out of scope

- **Member invitations** — step 5 of the build order, and the first thing that makes B2B real. This feature creates organizations with exactly one member and no way to add a second through the UI. That is the intended end state for this branch.
- **Role enforcement.** Stored, not checked (goal 8). Its own backlog row.
- **Plans, entitlements, billing** — steps 6 and 7.
- **An organization switcher, settings screen or member list in the UI.** The frontend should be unaware that organizations exist, beyond types that stop compiling.
- **Account deletion** (S8). Still no endpoint; this change only alters what one would have to do.
- **Renaming `Form.userId` in the API response.** Decide whether the field stays in the payload at all (goal 5 keeps the column; the wire format is a separate question) and record the decision.

## Execution prompt

> Read [10-saas-roadmap](../docs/sot/10-saas-roadmap.md) and the cascade map in [03-domain-model](../docs/sot/03-domain-model.md) before writing anything, then work in this order.
>
> **Step 1 — read before writing.** `backend/prisma/schema.prisma` (`User`, `Form`, and note `Form.user` is `onDelete: Cascade` with `@@index([userId])`). `backend/src/middleware/formOwnership.ts` — all 31 lines, both functions. The five `Form.userId` sites listed in Context, and the eight `verifyFormOwnership` call sites in `routes/forms.ts` and `routes/form-fields.ts`. `backend/src/routes/auth.ts` registration handler, which is where the personal organization has to be created. `frontend/src/services/forms.ts:34`. Confirm the counts above yourself; if a file has moved on, the spec is stale and the code wins.
>
> **Step 2 — schema, via the `prisma-schema-migration` skill.** Add `Organization` and `Membership`; add `Form.organizationId` as nullable **for now**. State the `onDelete` for `Membership → User`, `Membership → Organization` and `Form → Organization` in the PR description, with the blast radius of each — see point 4 above. Index `Membership.userId` and `Membership.organizationId`; the authorization check reads them on every authenticated request.
>
> **Step 3 — the data migration, and prove it against data.** Write it as a SQL migration, not a script someone has to remember to run: one `Organization` per existing `User`, one `owner` `Membership`, and `forms.organization_id` backfilled through it. Then **verify it against a database that already holds users and forms** — seed a few, run `migrate deploy` on a copy, and confirm every form landed in the right organization and none was orphaned. A migration that is correct on empty tables and wrong on populated ones passes CI today; that gap is a known backlog row, and this is the change most likely to be bitten by it.
>
> **Step 4 — make it required.** A second migration setting `forms.organization_id NOT NULL`, adding its index, and renaming `user_id` to `created_by_user_id`. Read the generated SQL; Prisma will plan a destructive step if the diff implies one.
>
> **Step 5 — authorization, in one place.** Rewrite `verifyFormOwnership` to resolve the caller's membership rather than compare `userId`. Keep the signature and keep the `404`. Every other ownership site then either calls it or filters by the caller's organizations — `POST /api/forms` sets `organizationId`, `GET /api/forms` and the export filter by it. Follow `backend-endpoint-pattern`: this is an explicit call inside the handler, not a new middleware layer ([04-backend-patterns §2](../docs/sot/04-backend-patterns.md)). Do **not** add `organizationId` to the JWT (point 3).
>
> **Step 6 — registration.** In `routes/auth.ts`, wrap user + organization + membership creation in `prisma.$transaction`. Name the personal organization from the user's name or email; pick a `slug` scheme that cannot collide and say what it is.
>
> **Step 7 — tests, the cross-tenant one first.** In `backend/tests/integration/`, because every claim here is a database claim: a member of organization A gets **404** — not 403 — on organization B's form for read, update, delete and CSV export; registration creates exactly one organization and one owner membership; the transaction rolls back cleanly on failure; and the cascade behaviour you chose in Step 2 does what you said. Write the cross-tenant test first and **watch it fail** against the pre-migration code. Then the mocked suite in `backend/tests/` for the route shapes.
>
> **Step 8 — frontend, minimally.** `npm run build --workspace=frontend` will name what breaks. Change types, not behaviour. Nothing in the UI should mention organizations.
>
> **Step 9 — verify.** `npm run test:backend`, `npm run test:integration`, `npm run test:frontend`, `npm run test:e2e`, `npx tsc --noEmit` in `backend/`, `npm run build --workspace=frontend`. Remember the integration suite runs against `vuepdf_test` and nothing migrates it locally — `migrate deploy` against it after Steps 3 and 4, or the suite fails with `relation does not exist` and it looks like a broken test. Then by hand: register two accounts, create a form in each, and confirm neither can reach the other's form by URL or by API.
>
> **Step 10 — document.** Run `sot-sync`. [03-domain-model](../docs/sot/03-domain-model.md): the new entities, the entity diagram, the **cascade map** — including what deleting a user now does and no longer does — and the indexes section. [10-saas-roadmap](../docs/sot/10-saas-roadmap.md): move what is now real out of the target design and into the documents that describe reality, and close step 4 in the build order. [07-security-and-privacy](../docs/sot/07-security-and-privacy.md): the authorization row now says membership, not ownership; add the tenancy boundary to the trust-boundary section; and state plainly that **roles are stored but not enforced**, in the style [`0007`](0007-security-headers-and-csp.md) and [`0008`](0008-session-hardening.md) used for their known limits. [06-api-reference](../docs/sot/06-api-reference.md) after re-reading the routes (`api-contract-guard`). [04-backend-patterns](../docs/sot/04-backend-patterns.md): how a tenancy check is written, so the next endpoint gets it right. [09-quality-and-testing](../docs/sot/09-quality-and-testing.md): the spec counts. Update `docs/BACKLOG.md` and file what was deferred — role enforcement at minimum. Set this file to `**Status:** done` and add an `## Outcome`.


## Outcome

**Done.** Verified on Node 22.22.0: backend 12 specs / 115 tests, integration **5 / 43**, frontend 29 / 241, E2E 7 / 38, plus `tsc --noEmit` on the backend and the frontend build.

### One branch, three migrations, proven against populated tables

Executed as one branch rather than five, per the spec. Three migrations: additive schema, an idempotent SQL backfill, then the contract.

**The contract migration is hand-written, and had to be.** `prisma migrate dev` plans the `user_id` → `created_by_user_id` rename as `DROP COLUMN` + `ADD COLUMN`, which would have silently discarded who created every existing form. It also refuses to run non-interactively once it sees a destructive step, which is how this was noticed. `RENAME COLUMN` keeps the data.

**The backfill was run against a database that already held users and forms**, in a scratch copy, because CI only ever applies migrations to an empty one:

- 3 users → 3 organizations, 3 owner memberships, 4 forms all placed correctly, 0 orphaned, 0 misplaced.
- Naming held for the awkward cases: a user with a name got it, a user with `NULL` got their email local part, and a user whose name was whitespace also got the email local part.
- Re-running inserted 0 and updated 0 — it is idempotent.
- Its guard fires: with one form left unattached it raises `Backfill incomplete: 1 form(s) have no organization` rather than letting the next migration fail on a `NOT NULL` constraint that explains nothing.
- The `NOT NULL` itself was then seen refusing bad data, which is the second layer.

### The cascade rewrite, verified rather than asserted

This is the part of the change that alters existing behaviour, and it was checked on real rows:

| Action | Before | Now |
|---|---|---|
| Delete a user | Destroyed their forms, fields and **every response ever collected** | Forms survive, `createdByUserId` → `NULL`, answers intact |
| Delete an organization | n/a | Destroys its forms and responses — the largest blast radius in the schema, and deliberate |

### Verified, not assumed

- **Removing the membership filter fails all eight tenancy tests** and nothing else. The filter is load-bearing.
- The tenancy suite was written and run **before** the migration, and passed — recorded honestly: it is a regression guard around the rewrite, not a bug reproduction, because the boundary already held through `userId`. Its value is precisely that it also passes after.
- By hand against a running API: a second account gets `404` (not `403`) reading, deleting and exporting the first account's form; its form list is empty; and the form payload contains no `organizationId`, `createdByUserId` or `userId`.

### Decisions the spec left open

- **`Form.createdByUserId` is nullable, with `onDelete: SetNull`.** Losing the record of who made a form is the right price for not destroying the organization's data when a user is deleted; `Restrict` would have blocked user deletion forever.
- **The wire format drops both ids.** `toApiForm` strips `organizationId` and `createdByUserId` from every form response. Nothing in the client used the old `userId`, tenancy is decided server-side, and internal ids no consumer needs are surface that later changes have to stay compatible with.
- **Goal 5's grep is not literally empty.** `grep -rn 'userId: req.userId' backend/src` returns one line, in `requireOrganizationId` — a `Membership` lookup by user, not a `Form` ownership check. The intent of the goal holds; the wording was too literal.

### Deferred and filed

In [`docs/BACKLOG.md`](../docs/BACKLOG.md): **role enforcement** (`Membership.role` is stored and never read, so every member can do everything including delete the organization — harmless while every organization has one member, not harmless the moment invitations ship), and **an organization can outlive its last member** (deleting the last member leaves the organization and its forms unreachable, invisible and still holding respondent data; the rule needs deciding alongside account deletion, S8).

Not touched, as scoped: invitations, plans, billing, any organization UI, and account deletion.
