# Source of Truth (SoT)

This directory is the single source of truth for the project: product intent, architecture, domain model, code patterns, security posture, operations, quality bar and roadmap.

It has two readers, and both matter equally:

- **A person joining the project**, who needs to understand not just what the code does but why it is shaped that way.
- **A Claude Code session**, which has no memory of previous sessions and must be able to reconstruct the necessary context from these documents plus the skills in [`.claude/skills/`](../../.claude/skills/) and the agents in [`.claude/agents/`](../../.claude/agents/).

Everything here is written to be **verifiable against the code**. Where a document states a fact about the system, that fact was read out of the source, not remembered.

## Index

| # | Document | What it answers |
|---|---|---|
| 01 | [Product and market](./01-product-and-market.md) | What we sell, to whom, why they would pay, what we deliberately do not build |
| 02 | [Architecture](./02-architecture.md) | How the system is put together, the real stack, where the load-bearing walls are |
| 03 | [Domain model](./03-domain-model.md) | Entities, invariants, lifecycles, delete/cascade semantics |
| 04 | [Backend patterns](./04-backend-patterns.md) | How an Express route is written here, and why that way |
| 05 | [Frontend patterns](./05-frontend-patterns.md) | Composables vs stores, async state, HTTP services, coordinate math |
| 06 | [API reference](./06-api-reference.md) | Canonical, code-verified contract of every endpoint |
| 07 | [Security and privacy](./07-security-and-privacy.md) | Auth model, threat surface, PII inventory, GDPR obligations |
| 08 | [Operations](./08-operations.md) | Environments, configuration, CI, deployment, observability, backups |
| 09 | [Quality and testing](./09-quality-and-testing.md) | Test strategy, what belongs at which level, definition of done |
| 10 | [SaaS roadmap](./10-saas-roadmap.md) | Target multi-tenant/billing architecture — **not implemented yet** — plus the [build order](./10-saas-roadmap.md#build-order), which does track real state and is where the next task is chosen |
| 11 | [Conventions](./11-conventions.md) | Commits, branches, naming, file layout, language policy |

Live backlog: [`docs/BACKLOG.md`](../BACKLOG.md) — *what is missing and how much it matters*. Build order: [10-saas-roadmap](./10-saas-roadmap.md#build-order) — *what is next*, because it carries the dependencies a priority column cannot. **When the two disagree, the chain wins.** Specs for work in progress: [`features/`](../../features/README.md).

## Rules that keep this alive

Documentation that is not maintained by rule decays into fiction. These are the rules:

1. **Code wins over documents, always.** If a document and the code disagree, the code is right and the document is a bug. Fix the document in the same change that revealed the drift.
2. **No endpoint is documented without opening its route file.** This is enforced by the `api-contract-guard` skill. It exists because an earlier iteration of the API docs described three field endpoints that never existed in the backend.
3. **Any change to the schema, the API, or an architectural pattern updates its SoT document in the same commit.** The `sot-sync` skill is the checklist; the `ship-checklist` skill is the gate before opening a PR.
4. **Aspirational content is fenced.** Anything not yet built lives in [10-saas-roadmap.md](./10-saas-roadmap.md) or is explicitly tagged `[NOT IMPLEMENTED]`. Never describe a planned feature in the present tense anywhere else.
5. **Findings get filed, not just noted.** A risk discovered while writing docs goes into [`docs/BACKLOG.md`](../BACKLOG.md) with a priority and a one-line rationale. A note that only lives in a document nobody triages is not a plan.

## Verification status — 2026-09-01

Read out of the source on this date, not assumed:

**Working today:** email/password auth (bcrypt) with 15-minute access tokens and a revocable, rotating refresh token in an `httpOnly` cookie; form CRUD with ownership checks resolved through a `Membership`; uploaded PDFs served only through signed, expiring URLs, from local disk or object storage; a canvas field editor with five field types; automatic extraction of existing AcroForm fields when a PDF is uploaded (`pdf-processor.ts`); embedding fields back into the physical PDF as an AcroForm on save, inline or on a queue; a public no-login form flow behind a `shareId`; per-type answer validation; a responses dashboard; CSV export with a UTF-8 BOM; plans, entitlements and metered usage; Stripe subscriptions for all three plans; a read-only `/api/v1` authenticated by an organization API key; and signed outbound webhooks for `response.created` with retries and a delivery log.

**Resolved since this block was last written:** the bulk-save data-loss defect ([`features/0001`](../../features/0001-stable-field-ids-and-safe-bulk-save.md) — field ids are stable, the save is a diff, and deleting a field that holds answers archives it via `Field.deletedAt`); per-IP rate limiting on the unauthenticated write paths ([`0002`](../../features/0002-rate-limiting-on-public-write-paths.md)), whose counters now live in a shared store when `REDIS_URL` is set ([`0018`](../../features/0018-shared-rate-limit-store.md)); the E2E suite ([`0003`](../../features/0003-e2e-suite-green-and-independent.md)); the author-supplied-regex ReDoS surface, now compiled by RE2 ([`0004`](../../features/0004-safe-author-supplied-regex.md)); CI and an enforced Node version ([`0005`](../../features/0005-working-ci-and-enforced-node-version.md)); public, permanent URLs for uploaded PDFs, now signed and expiring ([`0006`](../../features/0006-signed-expiring-urls-for-uploaded-pdfs.md)); the total absence of security headers, now `helmet` on the API plus a CSP on the SPA ([`0007`](../../features/0007-security-headers-and-csp.md)); the 7-day non-revocable session token in `localStorage` ([`0008`](../../features/0008-session-hardening.md)); single-tenant ownership, now `Organization` + `Membership` with `Form` owned by an organization ([`0009`](../../features/0009-organizations-own-resources.md)) — note that deleting a user no longer destroys their forms; one-person organizations, now joinable through an expiring, revocable invitation link with roles that are actually enforced ([`0010`](../../features/0010-member-invitations-and-role-enforcement.md)); a designed-but-unbuilt product, now running on the design system ([`0011`](../../features/0011-adopt-the-design-system.md)); unlimited free usage, now a frozen plan catalogue with entitlements checked inside each handler ([`0012`](../../features/0012-plan-catalogue-and-entitlements.md)); no way to charge anybody, now Stripe subscriptions with an idempotent webhook as the only writer of `Organization.planKey` ([`0013`](../../features/0013-stripe-subscriptions.md)), the branding entitlement wired and Checkout serialised per organization ([`0014`](../../features/0014-close-the-subscription-surface.md)), and the Team plan with purchased seats ([`0015`](../../features/0015-team-plan-and-purchased-seats.md)); PDFs that could only live on one container's disk, now behind a storage driver ([`0016`](../../features/0016-object-storage-for-uploaded-pdfs.md)); the embed blocking the request, now an optional queue with a worker entrypoint ([`0017`](../../features/0017-job-queue-for-pdf-embedding.md)); no machine-readable access to a customer's own data, now API keys and a read-only `/api/v1` ([`0019`](../../features/0019-api-keys-and-read-only-public-api.md)); and no way to be told about a submission, now signed outbound webhooks with SSRF-checked egress ([`0020`](../../features/0020-outbound-webhooks.md)). **No High security findings remain open** — see [07](./07-security-and-privacy.md).

**Not implemented at all:** **email delivery of any kind**, structured logging, error tracking, virus scanning, backups, and any linting (`npm run lint` succeeds while linting nothing — there is no ESLint config in the repo). **Built but unreachable from the product:** API keys and webhook endpoints, which have no SPA screen and are configured through the API alone — that is [A1 in what comes next](./10-saas-roadmap.md#what-comes-next). **Also designed but not built:** the landing page, whose technology is still an open decision ([02-architecture](./02-architecture.md#the-landing-page-an-open-decision-not-implemented)), the organization switcher and the organization-wide responses list, both of which need an endpoint that does not exist ([05-frontend-patterns §8](./05-frontend-patterns.md)). The rest of the design is the running app. **The build order is finished** — what is left is in [`docs/BACKLOG.md`](../BACKLOG.md), ordered by [what comes next](./10-saas-roadmap.md#what-comes-next).

**Migrations are baselined.** `backend/prisma/migrations/` holds `0_baseline` plus eleven migrations, the most recent being `20260901114512_webhooks`; every environment uses `prisma migrate deploy`, and a database that predates the baseline needs `migrate resolve --applied 0_baseline` once. See [08-operations.md](./08-operations.md#database-migrations).
