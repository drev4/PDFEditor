# Backlog

The live backlog. One row per item, ordered by what stands between the product and being sold safely — not by when it was noticed.

When an item is picked up it gets an execution spec in [`features/`](../features/README.md) and its row links to it. Reasoning behind each block is in [`docs/sot/`](./sot/README.md).

Last reviewed: **2026-08-28**.

## P0 — Blocks any real customer

| Item | Why | Reference |
|---|---|---|
| **Stable field ids and safe bulk save** | Saving a form that has responses silently destroys every answer already collected. Also the prerequisite for any external integration | [03-domain-model](./sot/03-domain-model.md) · [`features/0001`](../features/0001-stable-field-ids-and-safe-bulk-save.md) |
| **Baseline Prisma migrations** | `backend/prisma/migrations/` does not exist; everything runs on `db push`. No safe way to change a schema holding customer data, and it blocks every SaaS schema change | [08-operations](./sot/08-operations.md#database-migrations) · done as step 0 of [`features/0001`](../features/0001-stable-field-ids-and-safe-bulk-save.md) |
| **Rate limiting** on `POST /api/auth/login` and `POST /api/responses` | The only two unauthenticated write paths, both completely unthrottled | [07-security](./sot/07-security-and-privacy.md) (S2) |
| **Guard author-supplied regex** on the public response endpoint | A backtracking `pattern` blocks the single event loop for the whole service | [07-security](./sot/07-security-and-privacy.md) (S3) |
| **Frontend test suite cannot run below Node 20.19** | Vite 7 and jsdom 27 require `^20.19.0 \|\| >=22.12.0`. All 29 specs fail to start on Node 20.9 with `ERR_REQUIRE_ESM`, and 7 more fail on the missing `crypto.hash`. `engines` said `>=18.0.0`, so npm never warned — corrected, plus a `.nvmrc`, but anyone already on an old Node needs to upgrade | [09-quality](./sot/09-quality-and-testing.md) |
| **Database-backed integration tests** | Mocked Prisma cannot show cascades. This is precisely why the answer-loss defect shipped | [09-quality](./sot/09-quality-and-testing.md) · harness built in [`features/0001`](../features/0001-stable-field-ids-and-safe-bulk-save.md) |

## P1 — Security, privacy and operational readiness

| Item | Why | Reference |
|---|---|---|
| Signed, expiring URLs for uploaded PDFs | `/uploads` is served publicly with no auth, no expiry, no revocation | [07-security](./sot/07-security-and-privacy.md) (S1) |
| `helmet` + CSP + security headers | None are set today; near-zero effort | (S5) |
| Session hardening: shorter JWT expiry, refresh tokens, `httpOnly` cookie | A 7-day non-revocable token in `localStorage` turns any XSS into a week of account access | (S4) |
| Structured logging (`pino`) with request ids and redaction | No way to answer "what happened to our submission at 14:32"; also the only way to see the silent PDF-embed failures | [08-operations](./sot/08-operations.md) · (S9) |
| Account deletion and per-account data export | GDPR erasure and portability; neither exists | (S8) |
| Response retention policy and a respondent privacy notice | IP and user agent are collected from respondents with no notice, no limit and no actual anti-abuse use | (S7) |
| Password policy, lockout, breach check | 6-character minimum, unlimited attempts | (S10) |
| Type check, lint and build in CI | CI runs only tests, so type errors and broken builds reach `develop` | [08-operations](./sot/08-operations.md) |
| ESLint flat config in both workspaces | `npm run lint` currently succeeds while linting nothing | [09-quality](./sot/09-quality-and-testing.md) |
| Validate all configuration at boot with Zod | Only `JWT_SECRET` is checked; a wrong `BASE_URL` silently produces broken PDF links | [08-operations](./sot/08-operations.md) |
| Add `BASE_URL` to `backend/.env.example` | Used by the upload route, missing from the template | [08-operations](./sot/08-operations.md) |
| Automated backups with a tested restore | None exist; recovery time is unknown | [08-operations](./sot/08-operations.md) |
| Error tracking on API and SPA | Browser-side editor failures are invisible today | [08-operations](./sot/08-operations.md) |

## P2 — SaaS foundations

Ordered as a dependency chain — see the build order in [10-saas-roadmap](./sot/10-saas-roadmap.md).

| Item | Why |
|---|---|
| `Organization` + `Membership`, migrate `Form.userId` → `Form.organizationId` | The longest-lead schema change; cheap now, a rewrite later |
| Member invitations and roles (`owner / admin / member`) | The first feature that makes B2B real |
| `Plan` catalogue + entitlements service, `402` on limit reached | Validates limit UX before money is involved |
| Stripe integration + `Subscription` | Revenue |
| Object storage (S3/R2) for PDFs | Blocks running more than one replica or redeploying on ephemeral disk |
| Job queue (BullMQ + Redis) for PDF extraction and embedding | Currently synchronous inside the request; timeout risk on large PDFs |
| Public API with per-organization API keys | Requires stable field ids first |
| Webhooks with signed payloads, retries and a delivery log | Same prerequisite |
| Usage metering for responses per month | Needed for plan limits, and it must agree with the invoice |

## P3 — Product and technical debt

| Item | Why |
|---|---|
| PDF round-trip test: editor position → embedded AcroForm position | Nothing verifies the canvas-to-PDF scale coupling; it silently breaks on any zoom change | 
| Move the canvas/PDF scale into the data instead of two hard-coded constants | `DEFAULT_SCALE = 1.5` exists independently in both workspaces |
| Share request/response types between backend and frontend, generated from Zod | The two currently redeclare the contract by hand |
| i18n layer for UI copy | Spanish placeholders remain in an otherwise English UI |
| Server-state library (TanStack Query) for reads | Every store hand-manages loading, error and caching |
| Evaluate VueUse for `useDragAndDrop`, `useGridOverlay`, `useToolbarDrag` | Case by case; some encode editor-specific behaviour |
| Soft delete or export prompt before `DELETE /api/forms/:id` | Cascades to every response with no undo |
| Index on `Answer.fieldId` | Needed once bulk save counts answers per field |
| Virus scanning on uploads | Files are stored and served back from our own origin |
| Real readiness probe | `/health` returns `ok` with the database down |

## Repository housekeeping

| Item | Status |
|---|---|
| `origin/feature/sprint-3-public-forms` | Merged to `main` via PR #3, still alive on the remote. Delete or keep as history — needs a decision |
| Verify the full suite passes | `npm run test:all` has not been confirmed green in a clean checkout since the docs overhaul |
| Two abandoned bulk-fix commits on `develop` (`fb8acd8`, `771b77c`) | The apply-then-revert pair is already on the remote; net effect is zero, left alone rather than rewriting shared history |
