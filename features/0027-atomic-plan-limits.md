# 0027 — Plan limits that two requests cannot both pass

**Status:** done
**Priority:** P1 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md) — *Plan limits are read-then-write, so two concurrent requests can both pass at the boundary*)
**Branch:** `feature/0027-atomic-plan-limits`
**Related:** [04-backend-patterns §10](../docs/sot/04-backend-patterns.md) · [03-domain-model](../docs/sot/03-domain-model.md) · [09-quality-and-testing](../docs/sot/09-quality-and-testing.md) · [`features/0012`](0012-plan-catalogue-and-entitlements.md) · [`features/0014`](0014-close-the-subscription-surface.md) · [`features/0015`](0015-team-plan-and-purchased-seats.md)

## Context

Two of the three plan limits are **check-then-write with nothing in between**:

- `assertCanInvite(organizationId)` counts members and pending invitations, returns, and then `createInvitation` inserts the row in a separate statement — different transaction, no lock. Two invitations sent at the same instant on the last seat both count `n`, both pass, both insert. The organization ends up one person over what was paid for.
- `assertCanPublishForm(organizationId, formId)` has the identical shape, called from **two** routes: `PUT /api/forms/:id` (`routes/forms.ts:216`) and `PATCH /api/forms/:id/status` (`:240`). Two publishes at once on the last slot both succeed.

**Not introduced by [`features/0015`](0015-team-plan-and-purchased-seats.md)** — it is the shape every non-metered limit has had since [`features/0012`](0012-plan-catalogue-and-entitlements.md), and 0015 correctly did not change it while wiring the seat check. It was found by `saas-readiness-reviewer` on that branch.

**The third limit does not have the bug, and it is the model to copy.** `assertResponseWithinLimit(tx, organizationId)` takes a **transaction client** and claims the month with an atomic `upsert`-and-compare inside the submission's own transaction, precisely because check-then-increment lets two submissions past at `limit - 1`. The signature is the tell: the only limit that is safe is the only one that takes a `tx`.

The impact is mild and real: one seat or one published form over, for a customer who is paying. Not a free-tier bypass — you have to be at the boundary and click twice. That is why it is P1 and not urgent, and it is also why it must be fixed with something boring.

**No prior attempt.** `git log --all` has no branch and no revert for this.

## Why the obvious approach is wrong

### 1. `SELECT … FOR UPDATE` was rejected once in this codebase, and that reasoning does not apply here

`services/organization-lock.ts` says it plainly, and somebody reading it will reasonably conclude that database locks were considered and refused:

> *"The obvious shape is `SELECT … FOR UPDATE` on the subscription row. It does not work here … **on the first checkout there is no row to lock.** … The next shape is a transaction-scoped advisory lock, which does work for an absent row — but it is held only until the transaction commits, so covering the Stripe call means keeping a Postgres transaction open across a network round trip."*

**Both objections were about checkout, and neither survives here.**

- *No row to lock.* The row to lock is `organizations`, and it always exists — it is the tenant. Every one of these checks already has its id in hand.
- *A network call inside the transaction.* There is none. `createInvitation` hashes a token and inserts; publishing is one `prisma.form.update`. Both are local, sub-millisecond writes.

So the mechanism refused for checkout is the right one here, and the spec that refused it is the reason to say so out loud rather than inherit the conclusion.

### 2. Wrapping the check in a transaction is not enough — the lock has to come first

`prisma.$transaction(async tx => { await assertCanInvite(tx, orgId); await createInvitation(tx, …) })` looks like the fix and is not one. Under Postgres's default `READ COMMITTED`, two concurrent transactions each run the count before either commits its insert, neither sees the other's uncommitted row, and both pass. A transaction makes the two statements atomic; it does not make them *serialised*.

What serialises them is taking a lock on the organization row **before counting**:

```sql
SELECT id FROM organizations WHERE id = $1 FOR UPDATE
```

The second transaction blocks there until the first commits, then counts and sees `n + 1`. The lock must be the first statement in the transaction; taking it after the count restores the race exactly.

Use Prisma's tagged `$queryRaw` so the id is a bound parameter. **Never `$queryRawUnsafe`** — an organization id is not attacker-controlled today, and that is not a reason to write the interpolating version.

### 3. `SERIALIZABLE` is the other correct answer, and it costs more than it saves

Prisma supports `{ isolationLevel: 'Serializable' }`, and Postgres would then abort one of the two transactions with a serialization failure. It is more general than a row lock and needs no explicit `SELECT … FOR UPDATE`.

It is rejected for one reason: **it moves the failure to a retry loop.** A serialization failure surfaces as Prisma `P2034`, which is not a `402` and not something the client can act on, so every call site would need retry logic — and a retry that re-runs a handler which has already validated, checked a role and read a form is a second chance to get something else wrong. The row lock blocks and then proceeds, which needs no new failure mode at all.

### 4. Do not add a counter row for published forms or seats

`UsageCounter` exists because the response meter measures something a `count(*)` cannot: **submissions accepted in a period**, which is why deleting a form does not refund the month and why it legitimately disagrees with the row count.

Published forms and seats are not like that. They are `count(*)` over rows that exist right now, and a counter column would be a cache of a number the database already knows — free to drift, and drift with no meaning behind it. The lock keeps the count as the source of truth.

### 5. A test that fires two requests in sequence proves nothing

This is the part most likely to be done badly. `await request(app)...; await request(app)...` is two requests, one after the other, and it passes against the broken code. The test has to issue both **concurrently** against a **real** PostgreSQL —

```ts
const [a, b] = await Promise.all([invite('one@example.com'), invite('two@example.com')])
```

— and assert that exactly one is `201` and the other `402`, with the row count proving it. It goes in `backend/tests/integration/`, not the mocked suite: a mocked Prisma cannot express a lock, a transaction or a concurrent write, and `tests/mock-transaction.ts` says so about itself in its own comment.

Even then it is timing-dependent, so make it deterministic where it can be: the same test **must fail against `origin/develop`**, and if it does not, it is not testing this.

## Goal

Checkable when the work is done:

1. `assertCanInvite` and `assertCanPublishForm` take a `Prisma.TransactionClient` as their first parameter, exactly as `assertResponseWithinLimit` does. Every limit check in `services/entitlements.ts` then has the same shape, and the odd one out is gone.
2. Both take the organization row lock as the **first** statement of that transaction, before any count.
3. `POST /api/organizations/invitations` performs the check and the insert in one transaction; both publish paths in `routes/forms.ts` do the same with the form update.
4. **Two concurrent invitations on the last seat produce exactly one `201` and one `402`**, and the same for two concurrent publishes on the last slot. Integration tests assert both, using `Promise.all`, and **both fail against `origin/develop`**.
5. Nothing else changes: same statuses, same messages, same `402`-not-`403` rule. The existing suites' expectations are untouched.
6. The lock is scoped per organization — two different organizations publishing at the same moment do not block each other, and a test asserts it rather than assuming it.
7. `$queryRawUnsafe` appears nowhere.
8. `npm run test:frontend`, `npm run test:backend`, `npm run test:integration`, `npm run test:e2e`, `npm run build --workspace=frontend` and `cd backend && npx tsc --noEmit` all pass.

## Out of scope

- **`assertHasApiAccess` and `mustShowBranding`.** They read a plan capability and write nothing, so there is no window to close.
- **`getEntitlements`.** A read for a screen; a slightly stale meter on Settings is not a limit being bypassed.
- **The response meter.** Already atomic, and the model for this work. Do not touch it.
- **`services/organization-lock.ts`.** The in-process checkout lock stays exactly as it is — its reasoning is about a different problem, and this feature quotes it rather than changing it.
- **Making the limits distributed-safe beyond one database.** They already are: the row lock is in Postgres, which every replica shares. That is a difference worth noting against the in-process checkout lock, not a task.
- **Any change to plan numbers, messages or the catalogue.**

## Execution prompt

> Make the two read-then-write plan limits atomic. Apply `backend-endpoint-pattern` for the routes and `prisma-schema-migration` **only if** you conclude a schema change is needed — it is not, and if you find yourself writing a migration, re-read trap 4.
>
> **Write the failing tests first, and see them fail.** A new `backend/tests/integration/plan-limit-races.spec.ts`: an organization one seat from its limit issuing **two invitations with `Promise.all`**, and an organization one slot from its published-form limit issuing **two publishes with `Promise.all`** — one through `PUT /api/forms/:id` and one through `PATCH /api/forms/:id/status`, because both routes call the check. Assert exactly one `201`/`200` and one `402`, and assert the database agrees (`invitation.count`, `form.count({ where: { status: 'published' } })`). Run against the current code: **both must fail**, and if one passes, the requests are not actually concurrent. Add a third test that two *different* organizations do not block each other, so the fix cannot be "serialise everything".
>
> **Read first.** `backend/src/services/entitlements.ts` — all of `assertResponseWithinLimit`, which is the shape you are copying, and the two functions you are changing. `backend/src/services/organization-lock.ts` — the whole "Why this and not a database lock" section, because it says the opposite of what this feature does and the difference is the point (trap 1). `backend/src/routes/organizations.ts` around the invitation handler, for the ordering of `requireRole`, "already a member" and the seat check — that order is deliberate and must survive. `backend/src/routes/forms.ts:205-250`, both publish paths.
>
> **Build.** Give `assertCanInvite` and `assertCanPublishForm` a `tx: Prisma.TransactionClient` first parameter and make their helpers (`planFor`, `countPublishedForms`, `countSeatsInUse`, `seatLimitFor`) take it too. Add one small exported helper — `lockOrganization(tx, organizationId)` — that runs the `SELECT … FOR UPDATE` through tagged `$queryRaw`, and call it as the first statement of both asserts, with a comment saying why it is first. Then move the call sites into `prisma.$transaction`, keeping the check and the write inside one: `createInvitation` needs a `tx` parameter, and so does the `form.update` in each publish path. Keep everything outside the transaction outside it — `verifyFormOwnership`, `requireRole`, validation and the "already a member" check run before it opens, because a transaction should be short and none of them writes.
>
> **Tests.** The three integration tests above. The mocked suite will need `prismaMock.$transaction` to pass through where these routes are exercised — `tests/mock-transaction.ts` already does exactly that for `POST /api/responses`, so extend it rather than writing a second one, and keep its comment honest about what a mock cannot prove. Check `tests/integration/seats.spec.ts` and `form-counts.spec.ts` still pass **unchanged**: they are the existing evidence that the limits themselves still behave.
>
> **Verify.** All four suites and both type checks. Then confirm the failing tests now pass, and — the one that matters — re-run them against a `git stash` of your change to be certain they still fail without it.
>
> **On the way out.** Run `sot-sync`. [04-backend-patterns §10](../docs/sot/04-backend-patterns.md) is the main edit: it describes limit checks as explicit calls inside the handler, and must now say that every one of them takes a transaction and locks the organization first, with the reason. [03-domain-model](../docs/sot/03-domain-model.md) gains a line on the lock in its invariants — nothing in the schema changes, but the invariant "an organization never exceeds its seat limit" is now enforced rather than hoped for. [09-quality-and-testing](../docs/sot/09-quality-and-testing.md) records why the race tests must be integration tests and why `Promise.all` is load-bearing. Remove the backlog row, set this file to `**Status:** done` with an Outcome, and run `ship-checklist`.

## Outcome

Built as specified, with the row lock rather than `SERIALIZABLE` and with no schema change.

**What changed.** `lockOrganization(tx, organizationId)` is a new export in `backend/src/services/entitlements.ts` — `SELECT id FROM organizations WHERE id = $1 FOR UPDATE` through tagged `$queryRaw` — and it is the first statement of both `assertCanPublishForm(tx, organizationId, formId?)` and `assertCanInvite(tx, organizationId)`. Their helpers (`planFor`, `countPublishedForms`, `countSeatsInUse`, `seatLimitFor`) all take the client as a first parameter too, so the file now reads by signature: a function that refuses something takes a `tx`, one that only reports passes `prisma`. `POST /api/organizations/invitations` opens the transaction around the check and `createInvitation` (which gained an optional `tx`), and both publish paths in `routes/forms.ts` do the same around `form.update` — only when `status === 'published'`, so an ordinary save still costs no transaction.

**Two things that were not in the spec.**

- `countSeatsInUse` and `assertCanInvite` used `Promise.all` over their reads. Inside an interactive transaction that runs on one connection, so the parallelism buys nothing and only makes the statement order inside the transaction undefined. Both are sequential now.
- `seatLimitFor` is exported and called directly by `tests/integration/seats.spec.ts`, so its three call sites there gained a `prisma` argument. **Every assertion in that file is unchanged** and it passes as it stood — but the spec asked for it to pass *unchanged*, and three lines of it are not. The alternative was a defaulted `tx` as the last parameter on that one function, which would have left the module with two argument orders; consistency won.

**Tests.** `backend/tests/integration/plan-limit-races.spec.ts`, four tests. Three were written first and run against the unfixed code: two concurrent invitations on the last seat both returned `201`, a concurrent `PUT` and `PATCH` on the last publishing slot both returned `200`, and four publishes across two organizations all succeeded where two should have. All three pass now, and re-running them against `git stash push -- backend/src` reproduced the same three failures — which is what says they test the fix and not the weather. The fourth holds a `FOR UPDATE` on one organization's row from the test itself and asserts a publish in a *different* organization completes anyway: it passes either way today, and it is what makes goal 6 checkable rather than assumed — a global lock or a mutex around the check would fail it.

The mocked suite needed `$transaction` to pass through in `tests/forms.spec.ts` and `tests/entitlements.spec.ts`, so `tests/mock-transaction.ts` gained `passThroughTransactionOnly`, whose comment says plainly that the lock is invisible at that level and names the integration spec that can see it.

**All suites green:** frontend 393/393, backend mocked 248/248, integration 215 passed + 10 skipped (the Redis-dependent specs, unchanged), e2e 53/53, plus `tsc --noEmit`, `typecheck:tests` and the frontend build. `$queryRawUnsafe` appears nowhere in `backend/src` or `backend/tests`.

**Drift fixed on the way past**, since the documents were open: [10-saas-roadmap](../docs/sot/10-saas-roadmap.md) still described B1 (structured logging) and B2 (`asyncHandler`) as unbuilt after [`0025`](0025-structured-logging.md) and [`0026`](0026-async-handler.md) shipped, and [06-api-reference](../docs/sot/06-api-reference.md) still said `402` came from the two form routes only, when the invitation, API key and webhook routes emit it too.
