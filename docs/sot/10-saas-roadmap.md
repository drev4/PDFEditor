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

**What replaces the chain is not another chain.** Everything left is either a product decision nobody has taken — the prices and the legal facts — or work that has no dependencies on anything else and can be picked in any order. [`docs/BACKLOG.md`](../BACKLOG.md) is now the whole picture, and the priority column is finally the right thing to read. **[What comes next](#what-comes-next), at the end of this document, is the shortlist** — the same items, ordered by a judgement about what is worth doing first, with the few real dependencies among them named so they are not mistaken for a chain.

**Updated 2026-09-02: that ordering is no longer free.** The landing shipped, the waitlist is collecting, and the business SSOT committed to a private beta before 2026-09-30 (`PDFSaaS/docs/planning/ROADMAP.md`). A date is not a dependency, so it does not restart the chain — but it does override a judgement, and the shortlist below now leads with the work that date requires.

Step 8 took three features to close and the two follow-ups are both now done. `Plan.hasBranding` is enforced ([`features/0014`](../../features/0014-close-the-subscription-surface.md)) and `assertCanInvite` is wired ([`features/0015`](../../features/0015-team-plan-and-purchased-seats.md)) — it had been waiting not for "billing" but for a plan that can hold more than one person, which is Team. What remains open around billing is configuration and business decisions rather than code: live-mode Stripe setup, tax, and the amounts themselves — including how many seats Team's base price includes ([`docs/BACKLOG.md`](../BACKLOG.md)).

### Parallel track — the landing page

**Shipped, on 2026-09-02, and not from this repository.** It is live and indexable at `docaiflow.com`, built with Astro on Cloudflare Pages with the waitlist on Pages Functions, D1 and Turnstile, and its own repository is `PDFSaaS/landing` (`landing/docs/ROADMAP.md`, `landing/docs/operations/next-session.md`).

The reasoning for keeping it out of the chain held, and is worth keeping because it is the general rule: **the chain means *each step unblocks the next*, and the landing blocked nothing and nothing blocked it.** It was built in parallel and it finished first. What it turned out to depend on was not code either — a brand and a domain, both now decided as DocAIFlow — and it shipped *without* the support address, legal entity and registered address it was supposed to need, which are still open in [`docs/BACKLOG.md`](../BACKLOG.md).

**The consequence for this repository is the point.** A live page collecting waitlist addresses is what turned "no deployment target" from a filed item into the top of the list — see the D track in [what comes next](#what-comes-next).

### A known inversion between this chain and the backlog

[`docs/BACKLOG.md`](../BACKLOG.md) files **shared rate-limit store (Redis)** under P1 and **job queue (BullMQ + Redis)** under P2 — but the first needs the Redis the second brings. Priority says do the P1 item first; the chain says it cannot be done first.

**The chain wins.** A priority is a judgement and can be revised; a dependency cannot. That is the whole reason this document exists next to a flat priority list, and it is the rule to apply whenever the two disagree. Concretely, the options were to live with the per-process limiter until step 9, or to pull Redis forward as its own step and pay for the infrastructure earlier — not to attempt the P1 item on its stated priority.

**Resolved as of [`features/0017`](../../features/0017-job-queue-for-pdf-embedding.md).** The Redis is here, so the P1 item is now doable on its own priority; it was deliberately kept out of that feature, because a security-relevant change does not belong in a queue PR. Note one thing it inherits: the queue's Redis is **optional**, and a rate limiter's is not — a limiter that silently degrades to per-process when `REDIS_URL` is missing is the failure this repository has already reasoned about once with `TRUST_PROXY_HOPS`.

## What comes next

**Read this as a shortlist, not as a chain.** The build order above earns its ordering from dependencies: each step could not be attempted before the one above it. Nothing below has that property except where the row says so, so the order here is a *judgement about what is worth doing first* — revisable, unlike the chain, and that is why this section is kept separate rather than continuing the table with a step 11.

The ordering principle **changed on 2026-09-02, and it changed because of something outside this repository.** It used to be *close the gap between what is built and what a customer can reach, then make a failure diagnosable, then take the decisions that are not code* — the A/B/C shape below, which is kept because A and most of B are closed and the reasoning is worth reading.

What replaced it is a date. **The landing is live** at `docaiflow.com` and its waitlist is collecting real addresses (`landing/docs/operations/next-session.md`, verified 2026-09-02), and the business SSOT commits to a private beta before **2026-09-30** (`PDFSaaS/docs/planning/ROADMAP.md`). So the product now has customers arriving and **nowhere to send them**: [08-operations](./08-operations.md) says there is no production environment, no `Dockerfile` for either app and no infrastructure definition, and a repository-wide search finds no `Dockerfile` of any kind. That is the largest gap in the product today, and it displaced the old first place.

The new principle: **make the thing reachable and recoverable, then make what it holds erasable, then take the decisions that are not code.** Everything in the D track below is dated; nothing else is.

Verified against the code on **2026-09-02**; every claim below names the file it came from.

| # | Next | Kind | Depends on |
|---|---|---|---|
| D1 | **A deployment target, and the packaging to reach it** | Operability | The app/API domain decision — nothing in this repository |
| D2 | ~~**Boot-time configuration validation** (was B4)~~ — done ([`features/0028`](../../features/0028-boot-time-configuration-validation.md)) | Operability | — |
| D3 | ~~**Backups with a tested restore** (was B5)~~ — tooling and drill done ([`features/0037`](../../features/0037-backups-with-a-tested-restore.md)); **the schedule and the production drill wait on D1** | Operability | D1 |
| D4 | ~~**Error tracking on API and SPA**~~ — done ([`features/0034`](../../features/0034-error-tracking-on-api-and-spa.md)) | Operability | — |
| D5 | ~~**Erasure that is real**, and portability with it~~ — done ([`features/0029`](../../features/0029-account-deletion-and-real-erasure.md), [`features/0030`](../../features/0030-account-data-export.md)). **S8 is closed** | Privacy | — |
| D6 | ~~**A respondent privacy notice**~~ — done ([`features/0032`](../../features/0032-respondent-notice-and-ip-collection.md)), together with a per-form control that is **off by default**. The **retention limit** was deliberately not built: it needs a scheduler | Privacy | — |
| D7 | ~~**Close public registration** while the beta is invitation-only~~ — done ([`features/0033`](../../features/0033-close-public-registration.md)) | Product | — |
| A1 | ~~**API keys and webhooks screens in the SPA**~~ — done ([`features/0021`](../../features/0021-api-keys-screen.md), [`features/0022`](../../features/0022-webhooks-screen.md)) | Product | — |
| A2 | ~~**The active organization**, then the switcher~~ — done ([`features/0023`](../../features/0023-active-organization.md)) | Correctness + Product | — |
| A3 | ~~**Organization-wide responses listing**, then `/dashboard/responses`~~ — done ([`features/0024`](../../features/0024-organization-responses.md)) | Product | — |
| B1 | ~~**Structured logging (`pino`)**~~ — done ([`features/0025`](../../features/0025-structured-logging.md)) | Operability | — |
| B2 | ~~**`asyncHandler`** on every async route~~ — done ([`features/0026`](../../features/0026-async-handler.md)) | Correctness | — |
| B3 | ~~**Atomic plan limits** for publish and invite~~ — done ([`features/0027`](../../features/0027-atomic-plan-limits.md)) | Correctness | — |
| C1 | **Decide the prices, the legal entity, the support address** | Business | Nobody but the owner |
| C2 | ~~**Decide the landing technology**, then build the landing~~ — done, **in another repository** | Product | — |
| C3 | **Email delivery** | Product | A provider account |

**What the D track is not.** It is not a chain — D1 through D7 have almost no dependencies on each other, and only D3 genuinely waits on D1. They are grouped because one date owns all of them. And it is not the whole beta: the rest of that scope is business work (a cohort, an onboarding, a support channel) recorded in `PDFSaaS/docs/planning/ROADMAP.md`, not here.

**What the date deliberately does not include**, and the reason is worth keeping: the prices, the legal entity and VAT, Stripe in live mode, and the contradiction between `Plan.seats: 3` plus a per-seat quantity (`backend/src/services/plans.ts:134`) and a business decision to sell Team with unlimited users. **A free private beta charges nobody**, so every one of those blocks *revenue* rather than the date, and putting them in September would trade a deployment for a pricing page.

### D — the beta on 2026-09-30

**D1. A deployment target, and the packaging to reach it.** [08-operations §1](./08-operations.md) records the whole of it: production *does not exist*. `docker-compose.yml` provisions the database and is a development dependency, not a deployment artifact — the document says so in the line under the table, and it is the mistake this row exists to prevent. Three processes need somewhere to run, not one: the API, the **worker** (`node dist/worker.js`, the same build with a different entrypoint) and the built SPA. Two things are already written down and must be carried into whatever gets chosen. **`prisma` is a devDependency**, so the client has to be generated *before* `npm ci --omit=dev` prunes it or the image boots without one ([08-operations](./08-operations.md)). And **`REDIS_URL` set with no worker running fails silently** — no request errors, the queue just fills and every form's PDF quietly stops matching its fields; if the deployment sets that variable, something has to check the worker is alive.

**D2. Configuration validated at boot.** **Done** ([`features/0028`](../../features/0028-boot-time-configuration-validation.md)): `backend/src/config/validate-env.ts` checks the environment in `index.ts` and `worker.ts`, reports **every** problem rather than the first, and exits `1`. What it settled is in [08-operations](./08-operations.md); three things are worth carrying forward. **`config/env.ts` did not change** — a tunable still warns and falls back, and the new module only covers values with no safe default. **Strictness is an allowlist on `NODE_ENV`**, sharing `plans.ts`'s constant, so an unset or misspelled value is validated rather than waved through. And **the list of variables is kept honest by a scan**, `tests/config-coverage.spec.ts`, because a hand-written inventory of configuration is a second source of truth and would have drifted by the third new variable.

Why it was dated at all: **the first deploy is exactly when a variable is wrong for the first time**, and the failures this repository has already reasoned about — `STRIPE_WEBHOOK_SECRET`, `BASE_URL`, `WEBHOOK_SIGNING_KEY`, `PDF_STORAGE_DRIVER` — all produce no error on any path somebody is watching.

**D3. Backups with a tested restore.** **Tooling and drill done** ([`features/0037`](../../features/0037-backups-with-a-tested-restore.md)); the schedule and the production measurement still wait on D1. `backup:db`, `backup:objects` and `restore:verify` exist, and the drill was run and recorded in [`docs/runbooks/backup-and-restore.md`](../runbooks/backup-and-restore.md). Three things it settled are worth carrying forward.

**The word that mattered was *tested*, and it earned its place.** The first drill run failed on a real defect — `pg_restore` requires an explicit `--dbname` and, unlike `pg_dump`, will not take its target from `PGDATABASE` — so the backup script would have produced artifacts that the restore path could not consume. Nothing but running it would have found that. The document check was then made to fail on purpose, by removing three PDFs from storage, because a check that has only ever passed proves nothing.

**The interesting half was never PostgreSQL.** It is that there are **two** stores and `Form.pdfUrl` is the pointer between them, which nothing in the application keeps consistent — and since [`features/0029`](../../features/0029-account-deletion-and-real-erasure.md) they actively diverge. So the restore order is **bytes first, rows second**, the mirror of the deletion order rather than a copy of it, and the drill's headline assertion is the cross-store one: does each restored `pdfUrl` resolve to bytes that are actually there. A `pg_restore` that exits `0` answers none of that.

**What still waits on D1 is the part that makes it a control rather than a capability.** There is no schedule, because nothing in this codebase runs on a clock — the third row to hit that wall, after the deletion grace period and response retention — so the RPO is whatever a platform cron is set to and the deployment has to set it. And the measured recovery time is from a 736 KB development dataset, which says the procedure is correct and says nothing about production; the runbook says to re-run the drill against the real database within a week of the first deploy.

**D4. Error tracking.** **Done** ([`features/0034`](../../features/0034-error-tracking-on-api-and-spa.md)). Sentry on both sides, off unless a DSN is configured, reporting an allowlist and never a request body. Three things it settled are worth carrying forward.

**The dependency was met only halfway, and the row said otherwise.** It claimed a request id on every backend line meant "a tracked exception can be tied to the request that caused it" — but the id never left the process. There was no `res.setHeader` for it and `cors()` named no `exposedHeaders`, so the SPA could not have read one anyway. Closing that was part of the feature: `X-Request-Id` is now on every response and lands on `ApiError.requestId`, which is what actually joins a browser event to a server line.

**A default SDK install would have contradicted a decision already written down.** [08-operations](./08-operations.md#observability) says no request body reaches the log, ever, because answer values arrive keyed by field id and their paths are data — so no redaction list can cover them. That argument transfers exactly, which is why the tracker sends an allowlist and runs with `defaultIntegrations: false` rather than filtering afterwards.

**The respondent surface reports nothing, deliberately.** [`features/0032`](../../features/0032-respondent-notice-and-ip-collection.md) had just stopped storing a respondent's IP by default; shipping their browser session to a third-party processor without touching the notice it wrote would have walked that back silently. The cost is that a bug only reproducible on the public form is still invisible, and it is filed rather than glossed.

**D5. Erasure that is real.** **Done, except export** ([`features/0029`](../../features/0029-account-deletion-and-real-erasure.md)). `DELETE /api/account` deletes the account, every organization the caller is alone in, and the stored documents that go with them; `DELETE /api/forms/:id` now removes its document too. Three things it settled are worth carrying forward. **A key is not owned by the form that points at it** — `Form.pdfUrl` is unconstrained, so the collector asks whether any *surviving* form still references a key, and the integration suite fails when it is written the obvious way. **Rows first, bytes second**, because only one of the two orderings has a reversible failure. And **a cascade cannot reach Stripe**, so the subscription is cancelled above the transaction and a failure there abandons the deletion rather than completing it. What was deliberately not built: the thirty-day grace period, because nothing here runs on a clock, and **per-account export**, which was split out and is now also done ([`features/0030`](../../features/0030-account-data-export.md)): `GET /api/organizations/export` streams the whole tenant as one JSON document. Two things it settled. **A stream cannot change its mind about its status code**, so the document ends with `"complete": true` and that marker is the only thing distinguishing a finished file from a truncated one. And **the owner-or-admin check on it is not a confidentiality boundary** — a member can already assemble the same data one form at a time — which the code says out loud rather than implying. With it, **S8 is closed** and the Danger zone has the companion it was missing.

**D6. A respondent privacy notice.** **Done, except retention** ([`features/0032`](../../features/0032-respondent-notice-and-ip-collection.md)). `Form.collectsRespondentMetadata` decides whether a submission stores the respondent's address and browser, it is **off by default**, and the public form carries a notice that mentions an address only when one is actually recorded. Three things it settled. **The default is the decision** — the collection had no implemented purpose, and a default that kept collecting for a use that does not exist is the position [07-security](./07-security-and-privacy.md) itself called indefensible. **The flag has nothing to do with rate limiting**, which counts `req.ip` in flight and never reads the stored column; an integration test asserts a non-collecting form still repels a flood, because the tempting "consistent" wiring would hand every author a switch that disables their own abuse protection. And **the notice is the product's, not the author's**: a free-text field would produce a privacy statement wrong in the confident direction. Retention stays unbuilt and filed — it needs the same scheduler the deletion grace period does.

**D7. Close public registration.** **Done** ([`features/0033`](../../features/0033-close-public-registration.md)). `REGISTRATION_MODE=invite_only` makes `POST /api/auth/register` require a shared code held in `REGISTRATION_CODE`, and both directions are one operator action — set the variable, restart the API ([08-operations](./08-operations.md#closing-and-reopening-sign-ups)). Three things it settled are worth carrying forward.

**"The invitation flow already exists" was wrong, and finding out why is the reason specs are written against the code.** `POST /api/organizations/invitations/accept` does create an account for an invited person who has none — but always *into the inviter's organization*, and `routes/organizations.ts` says why it must never take the personal-organization path: two memberships would make `requireMembership` resolve arbitrarily. So invitations admit **a customer's colleague**, never a new customer, who needs an organization of their own. Closing registration on that assumption would have closed the beta to everybody, and the shared code exists because of it.

**The gate is in the handler, not over account creation.** A middleware across every path that creates a `User` is the obvious reading of "close registration" and it catches invitation acceptance — locking out the colleagues of the customers the beta is for. An integration test asserts that path still works with registration closed.

**A default cannot be safe on its own here.** `config/registration.ts` treats an unset mode as `open`; `validate-env.ts` requires the variable explicitly whenever `isStrict`. Neither literal default was safe — closed breaks every developer environment and four suites, open means a deploy that forgot the variable silently runs an open beta — so the pair is the mechanism, reusing the shape [`features/0028`](../../features/0028-boot-time-configuration-validation.md) already built.

### A — close the distance to the customer

**A1. The API keys and webhooks screens.** ~~Both pending.~~ **Both done** ([`features/0021`](../../features/0021-api-keys-screen.md), [`features/0022`](../../features/0022-webhooks-screen.md)). Settings has three tabs; `GET /api/organizations/entitlements` carries `hasApiAccess` so a tab knows whether to draw a create form; and the webhooks screen needed two endpoints nobody had noticed were missing — a **session-authenticated delivery log**, because the only reader was on `/api/v1` and needed an API key, and a **`PATCH` that re-enables**, because the queue could disable an endpoint and nothing could ever switch it back on. Everything paid for in step 10 is now reachable from the product. What is left around webhooks is filed and none of it blocks anything: nobody is *told* when an endpoint is disabled (that needs email), a delivery cannot be replayed, and a signing secret cannot be rotated. The reasoning below is kept.

**What it was.** The endpoints existed and were complete: `GET`/`POST`/`DELETE /api/organizations/api-keys` (`backend/src/routes/organizations.ts:435`, `:462`, `:492`) and the same three for `/webhooks` (`:581`, `:600`, `:642`), plus `GET /api/v1/webhooks/deliveries` (`backend/src/routes/v1/webhooks.ts:27`) for the delivery log. The SPA reached neither, so a Team customer who was *paying for API access* could not mint a key or point a webhook from the product — which is why this came first: it is the cheapest conversion of finished backend work into something sellable. Both are now reachable, as tabs inside Settings rather than sidebar destinations, so `useAppNav.ts` still lists four.

Two things the screens had to get right, and both were properties of the endpoints rather than of the design. **The secret is returned exactly once**, at creation, by both `POST` handlers — a screen that does not make the customer copy it there has lost it. And `GET /webhooks` returns a `deliverable` boolean, false when `REDIS_URL` or `WEBHOOK_SIGNING_KEY` is missing, which the screen surfaces as its own state: otherwise the customer configures an endpoint that will never fire and nothing says so. Both held, and both are now asserted by tests.

**A2. The active organization.** ~~A small endpoint two screens are waiting on.~~ **Done** ([`features/0023`](../../features/0023-active-organization.md)): `requireMembership` is now the one thing that decides which organization a request acts in, form reads are scoped to it, accepting an invitation lands you in the organization that invited you, and the sidebar has the switcher. Renaming stayed out and is filed. **That description was wrong, and finding out why is the reason specs are written against the code** ([`features/0023`](../../features/0023-active-organization.md)). Nothing in this application decides which organization a request acts in: reads span **every** membership (`memberOfCallerOrganization`) while writes and entitlements take the **oldest** (`requireMembership`), and invitations made belonging to two organizations reachable. Measured against a real database, a registered user who accepts an invitation into a Team organization sees its forms, creates forms into their own personal organization instead, and is metered against Free. So A2 is a `P1` correctness fix with a switcher on top, not a small endpoint — and the switcher is part of it rather than a follow-up, because without one the fix strands a two-organization user in whichever the fallback picks. Renaming stays a separate row.

**A3. Responses across the organization.** **Done** ([`features/0024`](../../features/0024-organization-responses.md)), and the paging decision it was waiting on went to `limit`/`offset` — matching the per-form listing and `/api/v1` rather than adding a third convention, with the known offset flaw accepted on a reading screen. The decision that turned out to matter more was a different one: the row carries **no answer values, no IP and no user agent**, because a browsing surface over everything the organization has collected is not where the per-form screen's respondent data belongs. **This closes the A track** — everything the build order paid for is now reachable from the product, and nothing in the navigation leads to a screen that says it is not built.

### B — make a failure diagnosable, and close the two shapes that are wrong

**B1. Structured logging.** **Done** ([`features/0025`](../../features/0025-structured-logging.md)): the backend logs through `pino` with a request id on every line. What it was blocking, and why it was first here: It is the highest-leverage row in P1 because three other items wait on it and cannot be done well without it: CSP violation reporting has nowhere to send reports, error tracking has nothing to correlate, and **the queued embed fails silently** — with `REDIS_URL` set and no worker running, no request errors and every form's PDF quietly stops matching its fields. Today the answer to "what happened to our submission at 14:32" is to read stdout.

**B2. `asyncHandler`.** **Done** ([`features/0026`](../../features/0026-async-handler.md)): every async handler is wrapped, and `tests/async-handler-coverage.spec.ts` fails when a new one is not. The shape it closed: Express 4 does not forward a rejected promise, so one missing `catch` is an unhandled rejection — and it has shipped before, in [`features/0016`](../../features/0016-object-storage-for-uploaded-pdfs.md). `process-guards.ts` keeps the process up on a rejection, which contains the blast radius but does not answer the request.

**B3. Atomic plan limits.** **Done** ([`features/0027`](../../features/0027-atomic-plan-limits.md)). `assertCanPublishForm` and `assertCanInvite` read a count and let the caller write in a separate statement, with no transaction and no row lock, so two requests on the last slot both passed. Both now take a `Prisma.TransactionClient` like `assertResponseWithinLimit` always did, run inside the transaction that writes, and take `SELECT … FOR UPDATE` on the organization row as that transaction's first statement.

Two things it settled that are worth carrying forward. **A transaction was not the fix** — under `READ COMMITTED` two of them still both count before either commits; the lock, taken *before* the count, is the whole mechanism. And **the shape is now uniform**: a function in `entitlements.ts` that refuses something takes a `tx` and one that only reports does not, so the odd one out is gone rather than being the only safe one. Details in [04-backend-patterns §10](./04-backend-patterns.md).

**This closes the B track.** B4 and B5 were its last two rows and both moved into D as D2 and D3 — not because they changed, but because the thing they were waiting for acquired a date. The note they carried is the one that survived: they *need a deployment target to be worth doing well*, which is exactly why D1 is above them.

### C — the decisions that are not code

These block on the owner, not on engineering. **C1** — the prices, the legal entity, the registered address, the support email — is still open, and the amounts also decide how many seats Team's base price includes ([`docs/BACKLOG.md`](../BACKLOG.md)). Note that no price is rendered from a constant anywhere in the code, deliberately, so deciding them is a Stripe change rather than a deploy. What did change is that **C1 no longer blocks the landing**, because the landing shipped without it; it now blocks charging, and the beta is free. **C2 is done, and it was done somewhere else** — the technology decision went to Astro on Cloudflare Pages and the page is live at `docaiflow.com` (`landing/docs/ROADMAP.md`, verified 2026-09-02). Two consequences for this repository: the brand and domain that [02-architecture](./02-architecture.md) records as undecided are decided, and the app and API still need their own hostnames, which is D1's one external dependency. **C3**, email delivery, is the row that keeps growing — it started as invitations the inviter copies and sends themselves, and step 10 added a second customer for it: an endpoint auto-disabled after ten consecutive failures, with nothing that tells its owner ([`features/0020`](../../features/0020-outbound-webhooks.md)).

### What is deliberately not on this list

Write endpoints on `/api/v1`, per-key scopes and key expiry, more webhook event types, replaying a delivery and rotating a webhook secret are all real and all filed — each of them extends a surface that, until A1 closed, **no customer could reach from the product at all**. That argument for deferring them is now spent: they are ordinary backlog rows competing on their own merits, and the priority column is the thing to read. The same applies to the two P2 rows that assume scale this deployment does not have: moving PDF extraction off the request path, and the cross-replica embed race that now remains only on the inline path.
