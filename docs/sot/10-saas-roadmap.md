# SaaS roadmap — `[NOT IMPLEMENTED]`

The entitlements shape, the public-API section and white-labeling are **target design — none of them exist in the code**. The `Organization`/`Membership` design is now **built** ([`features/0009`](../../features/0009-organizations-own-resources.md)) and its section says so; reality lives in [03-domain-model](./03-domain-model.md). Their job is to keep each piece that does get built compatible with the pieces that come after, so that arriving at B2B does not mean rewriting what B2C shipped.

The [build order](#build-order) at the end is the exception, and it is different in kind: it tracks **real state**. Every step is closed, so the `[NOT IMPLEMENTED]` tag on this title applies to the design sections above it, not to that table.

The division of labour with the backlog: [`docs/BACKLOG.md`](../BACKLOG.md) answers **what is missing and how much it matters**; the build order answers **what is next**. When priority and the chain disagree, the chain wins — see [the inversion](#a-known-inversion-between-this-chain-and-the-backlog) at the end for the case that already exists.

Business rationale is in [01-product-and-market.md](./01-product-and-market.md).

## The structural decision: organizations own resources, users do not

~~Target design.~~ **Built** ([`features/0009`](../../features/0009-organizations-own-resources.md)). `Organization`, `Membership` and `Form.organizationId` exist; every authorization check resolves a membership. The reality is described in [03-domain-model](./03-domain-model.md) and [04-backend-patterns §9](./04-backend-patterns.md) — this section is kept for the reasoning behind the shape, which is still the reasoning that governs what comes next.

Roles are enforced and invitations exist too ([`features/0010`](../../features/0010-member-invitations-and-role-enforcement.md)), and plans and entitlements are built ([`features/0012`](../../features/0012-plan-catalogue-and-entitlements.md)). What is **not** built, from here down: billing, the public API and white-labeling.

The shape:

```
Organization 1───* Membership *───1 User
Organization 1───* Form               (replacing User 1───* Form)
Organization 1───1 Subscription *───1 Plan
```

**A B2C account is an organization with exactly one member**, created automatically at signup. There is no separate "personal account" concept and no second code path.

This is worth doing before there is revenue, not after, and the reason is specific: the alternative — adding teams later by grafting them onto user-owned resources — means a migration that reassigns live customer data across a new ownership boundary while people are using it, plus a permanent fork in every authorization check. Slack, Notion and Linear all landed on this shape for the same reason.

### Entities

| Entity | Fields | Notes |
|---|---|---|
| `Organization` | `id, name, slug, createdAt` | `slug` for URLs and future white-labeling |
| `Membership` | `organizationId, userId, role` | `role: owner \| admin \| member`. Unique on `(organizationId, userId)` |
| `Plan` | `key, name, maxPublishedForms, maxResponsesPerMonth, seats, hasBranding, hasApiAccess` | **Built** as a frozen constant in `backend/src/services/plans.ts`, not a table — move to a table only when a customer needs custom limits. Note the field is `maxPublishedForms`, not `maxForms`: the design canvas meters how many forms are *published at once*, so drafting is always free and unpublishing frees a slot. `Organization.planKey` says which entry applies until `Subscription` exists |
| `Subscription` | `organizationId, planKey, stripeCustomerId, stripeSubscriptionId, status, currentPeriodEnd` | The **only** entity that knows Stripe exists |

Role semantics, minimum viable: `owner` bills and can delete the organization; `admin` manages forms and members; `member` manages the forms they created.

### Migration path — done

Executed in [`features/0009`](../../features/0009-organizations-own-resources.md) as **one branch**, not five deploys: the sequencing below exists to protect a running system with live data, and there was neither. The ordering was kept — additive schema, backfill, then contract — because the backfill has to be proven before the column can be required.

Three migrations: `organizations_and_memberships` (additive), `backfill_personal_organizations` (idempotent SQL that raises if any form is left without an organization), and `form_owned_by_organization` (`NOT NULL`, plus a hand-written `RENAME COLUMN` — Prisma plans a rename as DROP + ADD, which would have discarded every form's creator).

The original plan, kept because it is the right plan if this ever has to be redone against live data:

1. Add `Organization` and `Membership`. Nothing reads them yet.
2. Data migration: one personal `Organization` per existing `User`, with an `owner` `Membership`.
3. Add `Form.organizationId` as nullable; backfill from `Form.userId` through the membership.
4. Move every read and write to `organizationId`; keep `userId` populated as the creator.
5. Make `organizationId` required. Re-point the index. Keep `Form.userId` renamed to `createdByUserId` — it is genuinely useful and no longer means ownership.

This needs a real migration history, which now exists — see [08-operations.md](./08-operations.md#database-migrations).

## Entitlements: where plan limits get checked

~~Target design.~~ **Built** ([`features/0012`](../../features/0012-plan-catalogue-and-entitlements.md)) — `backend/src/services/entitlements.ts`, described in [04-backend-patterns §10](./04-backend-patterns.md). The design below is what was built, plus one thing this section did not anticipate: **a `402` must never reach a respondent**, so the two public paths refuse with the answers a closed form already gets. The section is kept for the reasoning.

Follow the pattern already established for ownership in [04-backend-patterns.md](./04-backend-patterns.md): an explicit, composable call inside the handler. **Not** a blanket middleware, because each resource has a different limit and a middleware cannot know which one applies without re-deriving the route.

```ts
// shape, not final code
async function assertCanCreateForm(organizationId: string) {
  const { plan, usage } = await getEntitlements(organizationId)
  if (usage.formsCount >= plan.maxForms) {
    throw new AppError(402, 'Plan limit reached: forms')
  }
}
```

Two rules:

- **`402 Payment Required` for a plan limit, `403 Forbidden` for a permission failure.** They are different rejections and the frontend must be able to show "upgrade your plan" versus "you do not have access" without parsing a message string.
- **Nothing in `routes/forms.ts` imports anything from the billing provider.** Domain routes ask the entitlements service a question about limits; only `services/stripe.ts` knows Stripe exists. This held through step 8 and is checkable: `grep -rn "from 'stripe'" backend/src` finds one file.

Response-per-month limits need a usage counter that does not require counting rows on every request. Design it as a monthly aggregate updated on write, and treat it as the same measurement the invoice will be based on — a metering number that disagrees with the invoice is worse than no number.

That is now `UsageCounter` ([03-domain-model](./03-domain-model.md)). Two things it settled: it counts **submissions accepted in the period**, so deleting a form does not refund the month; and it is claimed by an atomic upsert-and-compare inside the submission's transaction, because check-then-write lets two concurrent submissions past the last slot.

## Public API and integrations

The B2B buyer eventually wants responses in their own system rather than in our dashboard. Blocking prerequisites, all already tracked elsewhere:

- ~~**Stable field ids**~~ — **done** ([03-domain-model.md](./03-domain-model.md)). A `fieldId` handed out by the server now survives every save, so an integration can hold a durable reference to a field. Removing a field that has answers archives it rather than deleting it, so an id an integration stored never dangles.
- **Rate limiting** ([07-security-and-privacy.md](./07-security-and-privacy.md)).
- **Server-to-server auth**: `ApiKey { organizationId, hashedKey, scopes, lastUsedAt, expiresAt }`. Not user JWTs — those expire and are scoped to a person, which is wrong for an unattended process.
- **Webhooks** with signed payloads, retries with backoff, and a delivery log the customer can inspect. A webhook with no visible delivery history generates support tickets no one can answer.

## White-labeling

Removing the "Made with VuePDF" mark is a **plan entitlement** (`Plan.hasBranding`), never a user setting — that is what makes the free tier a distribution channel ([01](./01-product-and-market.md)). The entitlement is in the catalogue and, since step 8, an organization can genuinely be on a plan that has it — but nothing reads it yet: `PublicFormView.vue` still always shows the mark. That is the one thing step 8 unblocked and deliberately did not do.

Custom domains for public form links (`forms.customer.com`) are a much larger project: per-tenant TLS provisioning, domain ownership verification, and routing. Do not start it before a customer has said they will pay for it.

## Build order

A dependency chain, not a schedule. Each step unblocks the next.

This is the whole build order, not only the SaaS part of it — the security and operations work belongs in the same chain, because it is what everything below assumes. A step is only useful while it is ahead of you; the closed ones are kept as the record of what was cleared. The order they were actually executed in is in `git log`, not here.

| # | Step | Why it is here |
|---|---|---|
| 0 | ~~**Baseline Prisma migrations**~~ — done | Nothing below could safely change a schema holding customer data |
| 1 | ~~**Stable field ids and safe bulk save**~~ — done | Was an active data-loss bug, and is the prerequisite for every integration. [`features/0001`](../../features/0001-stable-field-ids-and-safe-bulk-save.md) |
| 2 | ~~**A gate that can be trusted**~~ — done | A red E2E suite gates nothing and a CI that never generated the Prisma client verifies nothing: without this, no step below could be *shown* to work. [`features/0003`](../../features/0003-e2e-suite-green-and-independent.md), [`features/0005`](../../features/0005-working-ci-and-enforced-node-version.md) |
| 3 | ~~**Risk removal on the public surface**~~ — done | The cheapest risk removal available, and the first questions on any security review. Rate limiting ([`0002`](../../features/0002-rate-limiting-on-public-write-paths.md)), regex guard ([`0004`](../../features/0004-safe-author-supplied-regex.md)), signed PDF URLs ([`0006`](../../features/0006-signed-expiring-urls-for-uploaded-pdfs.md)), security headers and CSP ([`0007`](../../features/0007-security-headers-and-csp.md)), session hardening ([`0008`](../../features/0008-session-hardening.md)). **No High findings remain open** ([07-security](./07-security-and-privacy.md)) |
| 4 | ~~**`Organization` + `Membership`** with data migration, no visible behaviour change~~ — done | The longest-lead schema change; done while the data was small. [`features/0009`](../../features/0009-organizations-own-resources.md) |
| 5 | ~~**Member invitations**~~ — done | The first feature that makes B2B real rather than a table with one row. Shipped with role enforcement, because neither is safe alone. [`features/0010`](../../features/0010-member-invitations-and-role-enforcement.md) |
| 6 | ~~**Adopt the design system** across the product~~ — done | The reason for putting it before step 7 held: the canvas already contained the **Plan & usage** and **Plan limit reached** screens, so step 7 builds them once, in a system that now exists. What shipped — and the three things on the canvas deliberately left unbuilt — is in [05-frontend-patterns §8](./05-frontend-patterns.md). [`features/0011`](../../features/0011-adopt-the-design-system.md) |
| 7 | ~~**`Plan` + entitlements**, limits enforced, no charging yet~~ — done | Validated the "limit reached" UX before money is involved, and it paid off immediately: the canvas meters *published* forms rather than created ones, which is a different check in a different handler than this table assumed. [`features/0012`](../../features/0012-plan-catalogue-and-entitlements.md) |
| 8 | ~~**Stripe + `Subscription`**~~ — done, **all three plans** | Actual revenue. The plan is now derived from what Stripe says: `Organization.planKey` kept its place as the thing every limit check reads, and gained exactly one writer — the webhook. `getEntitlements`, `effectivePlan` and `assertCanPublishForm` were not changed at all, which was the point of building them that way in step 7. **Team was not in it**, deliberately: it is priced per seat, and that quantity needed a design of its own. [`features/0013`](../../features/0013-stripe-subscriptions.md) **Closed fully by [`features/0015`](../../features/0015-team-plan-and-purchased-seats.md)**, which added Team, the per-seat quantity and the seat limit that was written in step 7 and left unwired. What per-seat cost, in design terms: `Subscription.quantity` is the first input to a limit check that does not come from the frozen catalogue, so step 7's property — one constant owns every limit — is now *nearly* true rather than true, and the exception is contained to one function, one plan family and one column ([04-backend-patterns §10](./04-backend-patterns.md)). The trade that bought that containment is a product cost, not a technical one: seats are **bought, not billed after the fact**, so adding somebody to a full plan is two steps rather than one. |
| 9 | ~~**Object storage + job queue**~~ — done | Required to run more than one replica; the reason to pull it earlier — PDF work blocking the event loop — is now half gone. **Object storage shipped in [`features/0016`](../../features/0016-object-storage-for-uploaded-pdfs.md)** and **the queue in [`features/0017`](../../features/0017-job-queue-for-pdf-embedding.md)**. They were split rather than built together because the ordering mattered: a worker in another process cannot read a file on the API container's local disk, so storage had to come first or the queue would have been built against storage that was about to be replaced. Two things to carry forward. **Only one of the three PDF operations moved** — the embed on bulk save, the one whose response nobody is waiting on; extraction on upload and on first read stays inline because both responses *carry* the fields they extract, and moving them is a product change with an async UX attached, filed in [`docs/BACKLOG.md`](../BACKLOG.md). And **the queue is optional**: `REDIS_URL` unset means the embed runs inline exactly as before, which keeps the suites offline and makes the rollback an environment variable — at the cost of two code paths that both have to work |
| 10 | ~~**Public API + API keys + webhooks**~~ — done | Only possible once step 1 is done. **API keys and a read-only `/api/v1` in [`features/0019`](../../features/0019-api-keys-and-read-only-public-api.md); outbound webhooks in [`features/0020`](../../features/0020-outbound-webhooks.md).** What the two halves decided, and what a successor must not undo: an API key authenticates an **organization and no user**, `/api/v1` is a **contract** while the rest of `/api/*` stays internal, and `services/webhook-egress.ts` is the only module that may request a customer-supplied URL — because until webhooks this backend made no outbound request at all, and a naive one is SSRF into its own network. Two deliberate gaps remain and are filed: **write endpoints** on the API, and **no customer-facing screen** for either keys or webhooks, so both are configured through the API alone |

Steps 0 through 3 are correctness and safety, not features. They come first because everything after them assumes the product does not lose data, does not fall over when pointed at, and can be verified. **They are all closed**, and so are steps 4 through 9.

**The build order is finished.** [`features/0019`](../../features/0019-api-keys-and-read-only-public-api.md) and [`features/0020`](../../features/0020-outbound-webhooks.md) closed step 10 between them, and both spent what step 9 built: the shared rate-limit store became load-bearing the moment a limit was *published*, and the queue is what makes webhook retries possible at all.

**What replaces the chain is not another chain.** Everything left is either a product decision nobody has taken — the prices, the landing page, the legal facts behind it — or work that has no dependencies on anything else and can be picked in any order. [`docs/BACKLOG.md`](../BACKLOG.md) is now the whole picture, and the priority column is finally the right thing to read. **[What comes next](#what-comes-next), at the end of this document, is the shortlist** — the same items, ordered by a judgement about what is worth doing first, with the few real dependencies among them named so they are not mistaken for a chain.

Step 8 took three features to close and the two follow-ups are both now done. `Plan.hasBranding` is enforced ([`features/0014`](../../features/0014-close-the-subscription-surface.md)) and `assertCanInvite` is wired ([`features/0015`](../../features/0015-team-plan-and-purchased-seats.md)) — it had been waiting not for "billing" but for a plan that can hold more than one person, which is Team. What remains open around billing is configuration and business decisions rather than code: live-mode Stripe setup, tax, and the amounts themselves — including how many seats Team's base price includes ([`docs/BACKLOG.md`](../BACKLOG.md)).

### Parallel track — the landing page

**The landing is not in the chain, and putting it there would be a lie.** The chain means *each step unblocks the next*; the landing blocks nothing and nothing blocks it. It is designed (desktop and phone artboards in the same canvas), it needs a technology decision nobody has taken, and it can be built at any point. Step 6 makes it cheaper rather than possible: the tokens it would use now exist in `frontend/tailwind.config.cjs`, whichever technology the page ends up being built with.

What it does depend on is not code: a support address, a legal entity, a registered address and at least one real customer reference. The canvas leaves all of those bracketed on purpose, and the prices on it match the Plan & usage screen without anybody having decided them. Both are in [`docs/BACKLOG.md`](../BACKLOG.md).

### A known inversion between this chain and the backlog

[`docs/BACKLOG.md`](../BACKLOG.md) files **shared rate-limit store (Redis)** under P1 and **job queue (BullMQ + Redis)** under P2 — but the first needs the Redis the second brings. Priority says do the P1 item first; the chain says it cannot be done first.

**The chain wins.** A priority is a judgement and can be revised; a dependency cannot. That is the whole reason this document exists next to a flat priority list, and it is the rule to apply whenever the two disagree. Concretely, the options were to live with the per-process limiter until step 9, or to pull Redis forward as its own step and pay for the infrastructure earlier — not to attempt the P1 item on its stated priority.

**Resolved as of [`features/0017`](../../features/0017-job-queue-for-pdf-embedding.md).** The Redis is here, so the P1 item is now doable on its own priority; it was deliberately kept out of that feature, because a security-relevant change does not belong in a queue PR. Note one thing it inherits: the queue's Redis is **optional**, and a rate limiter's is not — a limiter that silently degrades to per-process when `REDIS_URL` is missing is the failure this repository has already reasoned about once with `TRUST_PROXY_HOPS`.

## What comes next

**Read this as a shortlist, not as a chain.** The build order above earns its ordering from dependencies: each step could not be attempted before the one above it. Nothing below has that property except where the row says so, so the order here is a *judgement about what is worth doing first* — revisable, unlike the chain, and that is why this section is kept separate rather than continuing the table with a step 11.

The ordering principle: **first close the gap between what is built and what a customer can reach, then make a failure diagnosable, then take the decisions that are not code.** Step 10 shipped an API and webhooks that no screen exposes — the largest distance in the product today between work already paid for and value delivered.

Verified against the code on **2026-09-01**; every claim below names the file it came from.

| # | Next | Kind | Depends on |
|---|---|---|---|
| A1 | ~~**API keys screen in the SPA**~~ — done ([`features/0021`](../../features/0021-api-keys-screen.md)) · **the webhooks screen** is what is left of it | Product | Nothing |
| A2 | **An endpoint that returns the organization**, then the switcher and renaming | Product | Nothing |
| A3 | **Organization-wide responses listing**, then `/dashboard/responses` | Product | A paging decision |
| B1 | **Structured logging (`pino`)** with request ids and redaction | Operability | Nothing — and it unblocks three other rows |
| B2 | **`asyncHandler`** on every async route | Correctness | Nothing |
| B3 | **Atomic plan limits** for publish and invite | Correctness | Nothing |
| B4 | **Boot-time configuration validation** | Operability | Nothing |
| B5 | **Backups with a tested restore** | Operability | A deployment target |
| C1 | **Decide the prices, the legal entity, the support address** | Business | Nobody but the owner |
| C2 | **Decide the landing technology**, then build the landing | Product | C1 for its content |
| C3 | **Email delivery** | Product | A provider account |

### A — close the distance to the customer

**A1. The API keys and webhooks screens.** ~~Both pending.~~ **The keys half is done** ([`features/0021`](../../features/0021-api-keys-screen.md)): Settings has an `API keys` tab, `GET /api/organizations/entitlements` now carries `hasApiAccess` so the tab knows whether to draw a create form, and the webhooks tab is what remains — it needs a session-authenticated delivery log first, because the only one that exists is on `/api/v1` and needs a key. The reasoning below stood and is kept.

**What it was.** The endpoints existed and were complete: `GET`/`POST`/`DELETE /api/organizations/api-keys` (`backend/src/routes/organizations.ts:435`, `:462`, `:492`) and the same three for `/webhooks` (`:581`, `:600`, `:642`), plus `GET /api/v1/webhooks/deliveries` (`backend/src/routes/v1/webhooks.ts:27`) for the delivery log. The SPA reached neither, so a Team customer who was *paying for API access* could not mint a key from the product — which is why this came first: it is the cheapest conversion of finished backend work into something sellable. **Keys are now reachable** (`components/settings/ApiKeysPanel.vue`, `services/apiKeys.ts`); webhooks are not, and `useAppNav.ts` still lists four destinations, because both tabs live inside Settings rather than in the sidebar.

Two things the screens must get right, and both are properties of the endpoints rather than of the design. **The secret is returned exactly once**, at creation, by both `POST` handlers — a screen that does not make the customer copy it there has lost it. And `GET /webhooks` returns a `deliverable` boolean, false when `REDIS_URL` or `WEBHOOK_SIGNING_KEY` is missing, which the screen has to surface: otherwise the customer configures an endpoint that will never fire and nothing says so.

**A2. An endpoint that returns the organization.** `SettingsView.vue:186` says out loud that renaming the organization is not built because no endpoint returns its name, and the design canvas puts a switcher at the top of the sidebar that has nothing to read. A small endpoint that two screens are waiting on.

**A3. Responses across the organization.** `ResponsesIndexView.vue` is a `NotBuiltYet` placeholder, and the only listings are per-form: `GET /api/forms/:id/responses` and `GET /api/forms/:id/responses/export` (`backend/src/routes/forms.ts:338`, `:374`). It is third rather than first because it is the one of the three that needs a decision — paging and ordering the server agrees to, rather than one request per form merged in the browser.

### B — make a failure diagnosable, and close the two shapes that are wrong

**B1. Structured logging.** Nothing in `backend/` imports `pino`; the log is `console` and stdout. It is the highest-leverage row in P1 because three other items wait on it and cannot be done well without it: CSP violation reporting has nowhere to send reports, error tracking has nothing to correlate, and **the queued embed fails silently** — with `REDIS_URL` set and no worker running, no request errors and every form's PDF quietly stops matching its fields. Today the answer to "what happened to our submission at 14:32" is to read stdout.

**B2. `asyncHandler`.** `grep -rn asyncHandler backend/src` finds nothing: every async route depends on its own `try`/`catch`. Express 4 does not forward a rejected promise, so one missing `catch` is an unhandled rejection — and it has shipped before, in [`features/0016`](../../features/0016-object-storage-for-uploaded-pdfs.md). `process-guards.ts` keeps the process up on a rejection, which contains the blast radius but does not answer the request.

**B3. Atomic plan limits.** `assertCanPublishForm` (`backend/src/services/entitlements.ts:234`) and `assertCanInvite` (`:278`) read a count and let the caller write in a separate statement, with no transaction and no row lock — two requests on the last slot both pass. The fix already exists in the same file: `assertResponseWithinLimit` (`:386`) takes a transaction and claims the month with an atomic upsert-and-compare, precisely because check-then-write does not hold. The impact is milder here — one seat or one published form over, by a paying customer — which is why it sits below logging rather than above it.

**B4. Configuration validated at boot.** `backend/src/config/env.ts` is a pair of readers (`envBool`, `envInt`) that warn and fall back, which is right for a tunable; what is missing is the schema for values that must be present and well-formed. Only `JWT_SECRET` refuses to boot (`backend/src/app.ts:24`), so a wrong `BASE_URL` still produces broken PDF links quietly.

**B5. Backups with a tested restore.** Unchanged from the backlog: none exist, and recovery time is unknown. Last in this group only because it needs a deployment target to be real — not less important than the rest.

### C — the decisions that are not code

These block on the owner, not on engineering, and they are ordered by what the others need. **C1** — the prices, the legal entity, the registered address, the support email — is what the landing cannot ship without, and the amounts also decide how many seats Team's base price includes ([`docs/BACKLOG.md`](../BACKLOG.md)). Note that no price is rendered from a constant anywhere in the code, deliberately, so deciding them is a Stripe change rather than a deploy. **C2** is the landing, which stays a [parallel track](#parallel-track--the-landing-page): its technology is an open decision ([02-architecture](./02-architecture.md)), and if it stays open it gets taken by whoever opens an editor first. **C3**, email delivery, is the row that keeps growing — it started as invitations the inviter copies and sends themselves, and step 10 added a second customer for it: an endpoint auto-disabled after ten consecutive failures, with nothing that tells its owner ([`features/0020`](../../features/0020-outbound-webhooks.md)).

### What is deliberately not on this list

Write endpoints on `/api/v1`, per-key scopes and key expiry, more webhook event types, and replaying a delivery are all real and all filed — but each extends a surface **no customer can reach from the product yet**. They are worth doing after A1, not before it. The same applies to the two P2 rows that assume scale this deployment does not have: moving PDF extraction off the request path, and the cross-replica embed race that now remains only on the inline path.
