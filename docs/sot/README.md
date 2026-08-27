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
| 10 | [SaaS roadmap](./10-saas-roadmap.md) | Target multi-tenant/billing architecture — **not implemented yet** |
| 11 | [Conventions](./11-conventions.md) | Commits, branches, naming, file layout, language policy |

Live backlog: [`docs/BACKLOG.md`](../BACKLOG.md). Specs for work in progress: [`features/`](../../features/README.md).

## Rules that keep this alive

Documentation that is not maintained by rule decays into fiction. These are the rules:

1. **Code wins over documents, always.** If a document and the code disagree, the code is right and the document is a bug. Fix the document in the same change that revealed the drift.
2. **No endpoint is documented without opening its route file.** This is enforced by the `api-contract-guard` skill. It exists because an earlier iteration of the API docs described three field endpoints that never existed in the backend.
3. **Any change to the schema, the API, or an architectural pattern updates its SoT document in the same commit.** The `sot-sync` skill is the checklist; the `ship-checklist` skill is the gate before opening a PR.
4. **Aspirational content is fenced.** Anything not yet built lives in [10-saas-roadmap.md](./10-saas-roadmap.md) or is explicitly tagged `[NOT IMPLEMENTED]`. Never describe a planned feature in the present tense anywhere else.
5. **Findings get filed, not just noted.** A risk discovered while writing docs goes into [`docs/BACKLOG.md`](../BACKLOG.md) with a priority and a one-line rationale. A note that only lives in a document nobody triages is not a plan.

## Verification status — 2026-08-28

Read out of the source on this date, not assumed:

**Working today:** JWT auth (bcrypt, 7-day tokens); form CRUD with ownership checks; a canvas field editor with five field types; automatic extraction of existing AcroForm fields when a PDF is uploaded (`pdf-processor.ts`); embedding fields back into the physical PDF as an AcroForm on save; a public no-login form flow behind a `shareId`; per-type answer validation; a responses dashboard; CSV export with a UTF-8 BOM.

**Known correctness defect, unfixed:** saving fields from the editor (`POST /api/forms/:formId/fields/bulk`) deletes and recreates every field, which cascade-deletes the answers of responses already collected. See [03-domain-model.md](./03-domain-model.md#cascade-map) and [`features/0001-stable-field-ids-and-safe-bulk-save.md`](../../features/0001-stable-field-ids-and-safe-bulk-save.md). A fix was attempted and reverted twice; it is being redesigned rather than patched.

**Not implemented at all:** organizations, roles beyond "owner of a form", plans, entitlements, billing, public API, API keys, webhooks, rate limiting, structured logging, object storage, background jobs, virus scanning, and any linting. Several of these are prerequisites for selling this, not nice-to-haves — see [07](./07-security-and-privacy.md), [08](./08-operations.md) and [10](./10-saas-roadmap.md).

**Migrations are baselined.** `backend/prisma/migrations/` holds `0_baseline` plus the soft-delete migration; every environment uses `prisma migrate deploy`, and a database that predates the baseline needs `migrate resolve --applied 0_baseline` once. See [08-operations.md](./08-operations.md#database-migrations).
