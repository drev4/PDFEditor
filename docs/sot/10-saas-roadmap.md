# SaaS roadmap — `[NOT IMPLEMENTED]`

The entitlements shape, the public-API section and white-labeling are **target design — none of them exist in the code**. The `Organization`/`Membership` design is now **built** ([`features/0009`](../../features/0009-organizations-own-resources.md)) and its section says so; reality lives in [03-domain-model](./03-domain-model.md). Their job is to keep each piece that does get built compatible with the pieces that come after, so that arriving at B2B does not mean rewriting what B2C shipped.

The [build order](#build-order) at the end is the exception, and it is different in kind: it tracks **real state**. Steps 0 to 8 are closed; step 9 (object storage + job queue) is next, so the `[NOT IMPLEMENTED]` tag on this title applies to the design sections above it, not to that table.

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
| 8 | ~~**Stripe + `Subscription`**~~ — done, **all three plans** | Actual revenue. The plan is now derived from what Stripe says: `Organization.planKey` kept its place as the thing every limit check reads, and gained exactly one writer — the webhook. `getEntitlements`, `effectivePlan` and `assertCanPublishForm` were not changed at all, which was the point of building them that way in step 7. **Team is not in it**: it is priced per seat, which means keeping a Stripe quantity in step with `Membership`, and that is its own change with its own failure modes. [`features/0013`](../../features/0013-stripe-subscriptions.md) **Closed fully by [`features/0015`](../../features/0015-team-plan-and-purchased-seats.md)**, which added Team, the per-seat quantity and the seat limit that was written in step 7 and left unwired. What per-seat cost, in design terms: `Subscription.quantity` is the first input to a limit check that does not come from the frozen catalogue, so step 7's property — one constant owns every limit — is now *nearly* true rather than true, and the exception is contained to one function, one plan family and one column ([04-backend-patterns §10](./04-backend-patterns.md)). The trade that bought that containment is a product cost, not a technical one: seats are **bought, not billed after the fact**, so adding somebody to a full plan is two steps rather than one. |
| 9 | **Object storage + job queue** | Required to run more than one replica; pull earlier if PDF timeouts appear. Also brings the Redis that the shared rate-limit store needs — see the inversion below |
| 10 | **Public API + API keys + webhooks** | Only possible once step 1 is done |

Steps 0 through 3 are correctness and safety, not features. They come first because everything after them assumes the product does not lose data, does not fall over when pointed at, and can be verified. **They are all closed**, and so are steps 4 through 8. Next is step 9, object storage and the job queue.

Step 8 took three features to close and the two follow-ups are both now done. `Plan.hasBranding` is enforced ([`features/0014`](../../features/0014-close-the-subscription-surface.md)) and `assertCanInvite` is wired ([`features/0015`](../../features/0015-team-plan-and-purchased-seats.md)) — it had been waiting not for "billing" but for a plan that can hold more than one person, which is Team. What remains open around billing is configuration and business decisions rather than code: live-mode Stripe setup, tax, and the amounts themselves — including how many seats Team's base price includes ([`docs/BACKLOG.md`](../BACKLOG.md)).

### Parallel track — the landing page

**The landing is not in the chain, and putting it there would be a lie.** The chain means *each step unblocks the next*; the landing blocks nothing and nothing blocks it. It is designed (desktop and phone artboards in the same canvas), it needs a technology decision nobody has taken, and it can be built at any point. Step 6 makes it cheaper rather than possible: the tokens it would use now exist in `frontend/tailwind.config.cjs`, whichever technology the page ends up being built with.

What it does depend on is not code: a support address, a legal entity, a registered address and at least one real customer reference. The canvas leaves all of those bracketed on purpose, and the prices on it match the Plan & usage screen without anybody having decided them. Both are in [`docs/BACKLOG.md`](../BACKLOG.md).

### A known inversion between this chain and the backlog

[`docs/BACKLOG.md`](../BACKLOG.md) files **shared rate-limit store (Redis)** under P1 and **job queue (BullMQ + Redis)** under P2 — but the first needs the Redis the second brings. Priority says do the P1 item first; the chain says it cannot be done first.

**The chain wins.** A priority is a judgement and can be revised; a dependency cannot. That is the whole reason this document exists next to a flat priority list, and it is the rule to apply whenever the two disagree. Concretely, the options here are to live with the per-process limiter until step 9, or to pull Redis forward as its own step and pay for the infrastructure earlier — not to attempt the P1 item on its stated priority.
