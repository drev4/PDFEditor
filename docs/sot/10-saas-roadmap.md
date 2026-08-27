# SaaS roadmap — `[NOT IMPLEMENTED]`

Everything in this document is target design. None of it exists in the code. Its job is to keep each piece that does get built compatible with the pieces that come after, so that arriving at B2B does not mean rewriting what B2C shipped.

Business rationale is in [01-product-and-market.md](./01-product-and-market.md).

## The structural decision: organizations own resources, users do not

Today `Form.userId` points at a `User`, and every ownership check reads `where: { userId: req.userId }`.

Target:

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
| `Plan` | `key, maxForms, maxResponsesPerMonth, hasBranding, hasApiAccess, seats` | Start as a **constant in code**, not a table. Move to a table only when a customer needs custom limits |
| `Subscription` | `organizationId, planKey, stripeCustomerId, stripeSubscriptionId, status, currentPeriodEnd` | The **only** entity that knows Stripe exists |

Role semantics, minimum viable: `owner` bills and can delete the organization; `admin` manages forms and members; `member` manages the forms they created.

### Migration path

Sequenced so that each step is independently deployable and reversible:

1. Add `Organization` and `Membership`. Nothing reads them yet.
2. Data migration: one personal `Organization` per existing `User`, with an `owner` `Membership`.
3. Add `Form.organizationId` as nullable; backfill from `Form.userId` through the membership.
4. Move every read and write to `organizationId`; keep `userId` populated as the creator.
5. Make `organizationId` required. Re-point the index. Keep `Form.userId` renamed to `createdByUserId` — it is genuinely useful and no longer means ownership.

This needs a real migration history, which **does not exist today** — see [08-operations.md](./08-operations.md#database-migrations). Baselining migrations is a hard prerequisite for step 1.

## Entitlements: where plan limits get checked

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
- **Nothing in `routes/forms.ts` imports anything from the billing provider.** Domain routes ask the entitlements service a question about limits; only `SubscriptionService` knows Stripe exists.

Response-per-month limits need a usage counter that does not require counting rows on every request. Design it as a monthly aggregate updated on write, and treat it as the same measurement the invoice will be based on — a metering number that disagrees with the invoice is worse than no number.

## Public API and integrations

The B2B buyer eventually wants responses in their own system rather than in our dashboard. Blocking prerequisites, all already tracked elsewhere:

- **Stable field ids** ([03-domain-model.md](./03-domain-model.md)). An integration that stores a `fieldId` cannot survive the owner editing the form. This is the single hardest blocker and it is also a live data-loss bug, which is why it is first in the build order.
- **Rate limiting** ([07-security-and-privacy.md](./07-security-and-privacy.md)).
- **Server-to-server auth**: `ApiKey { organizationId, hashedKey, scopes, lastUsedAt, expiresAt }`. Not user JWTs — those expire and are scoped to a person, which is wrong for an unattended process.
- **Webhooks** with signed payloads, retries with backoff, and a delivery log the customer can inspect. A webhook with no visible delivery history generates support tickets no one can answer.

## White-labeling

Removing the "Made with VuePDF" mark is a **plan entitlement** (`Plan.hasBranding`), never a user setting — that is what makes the free tier a distribution channel ([01](./01-product-and-market.md)).

Custom domains for public form links (`forms.customer.com`) are a much larger project: per-tenant TLS provisioning, domain ownership verification, and routing. Do not start it before a customer has said they will pay for it.

## Build order

A dependency chain, not a schedule. Each step unblocks the next.

| # | Step | Why it is here |
|---|---|---|
| 0 | **Baseline Prisma migrations** | Nothing below can safely change a schema holding customer data |
| 1 | **Stable field ids and safe bulk save** | An active data-loss bug, and a prerequisite for every integration. [`features/0001`](../../features/0001-stable-field-ids-and-safe-bulk-save.md) |
| 2 | **Rate limiting, security headers, regex guard** | The cheapest risk removal available, and the first questions on any security review |
| 3 | **`Organization` + `Membership`** with data migration, no visible behaviour change | The longest-lead schema change; do it while the data is small |
| 4 | **Member invitations** | The first feature that makes B2B real rather than a table with one row |
| 5 | **`Plan` + entitlements**, limits enforced, no charging yet | Validates the "limit reached" UX before money is involved |
| 6 | **Stripe + `Subscription`** | Actual revenue |
| 7 | **Object storage + job queue** | Required to run more than one replica; pull earlier if PDF timeouts appear |
| 8 | **Public API + API keys + webhooks** | Only possible once step 1 is done |

Steps 0 through 2 are correctness and safety, not features. They come first because everything after them assumes the product does not lose data and does not fall over when pointed at.
