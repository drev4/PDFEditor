# Backlog

The live backlog. One row per item, ordered by what stands between the product and being sold safely — not by when it was noticed.

When an item is picked up it gets an execution spec in [`features/`](../features/README.md) and its row links to it. Reasoning behind each block is in [`docs/sot/`](./sot/README.md).

Last reviewed: **2026-08-28**.

## P0 — Blocks any real customer

| Item | Why | Reference |
|---|---|---|
| **Frontend test suite cannot run below Node 20.19** | Vite 7 and jsdom 27 require `^20.19.0 \|\| >=22.12.0`. All 29 specs fail to start on Node 20.9 with `ERR_REQUIRE_ESM`, and 7 more fail on the missing `crypto.hash`. `engines` said `>=18.0.0`, so npm never warned — corrected, plus a `.nvmrc`, but anyone already on an old Node needs to upgrade. Now sharper: `.nvmrc` says 22.12.0 while CI runs `node-version: 20.x`, and `re2` is a native module whose binary is ABI-bound — switching Node without `npm rebuild re2` disables pattern validation | [09-quality](./sot/09-quality-and-testing.md) · [08-operations](./sot/08-operations.md) |

## P1 — Security, privacy and operational readiness

| Item | Why | Reference |
|---|---|---|
| Shared rate-limit store (Redis) | The limiters use an in-memory store, so the effective limit multiplies by replica count and resets on every deploy. Fine at one replica; not fine the moment the service scales out. Depends on the Redis that arrives with the job queue | [07-security](./sot/07-security-and-privacy.md) · [`features/0002`](../features/0002-rate-limiting-on-public-write-paths.md) |
| Account-level lockout on repeated failed logins | Per-IP limiting does not stop credential stuffing distributed across hosts. Deliberately deferred: a per-account limiter without an unlock path lets anyone lock a named user out by spamming their address, so it needs the notification and unlock flow designed with it (S10) | [07-security](./sot/07-security-and-privacy.md) (S10) |
| A global fallback rate limiter | Only the three unauthenticated write paths are limited. Everything else — including `GET /api/forms/public/:shareId` and `/uploads` — is unthrottled. Picking a global number that does not break the editor's legitimate bursts needs traffic data we do not have yet | [07-security](./sot/07-security-and-privacy.md) |
| No UI for authoring a field `pattern` | `FieldPropertiesPanel.vue` has no pattern input, so the only way to set one is the API. Now that patterns are validated and a useful `400` names the problem, a UI is worth having — it needs live validation and must explain that lookahead/lookbehind/backreferences are unsupported | [`features/0004`](../features/0004-safe-author-supplied-regex.md) |
| Frontend still compiles patterns with native `RegExp` | `frontend/src/composables/useFormValidation.ts:42` runs the author's pattern in the respondent's browser. Lower severity than the server case — it burns the respondent's own tab, not shared infrastructure, and it is already `try/catch`-wrapped — but it should agree with the backend's engine, or the two will disagree about which patterns are valid | [`features/0004`](../features/0004-safe-author-supplied-regex.md) |
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
| `DELETE /api/forms/:formId/fields/:fieldId` still hard-deletes answers | The bulk save now archives a field that holds responses; the individual delete still cascades them away. Deliberately left as an explicit user act in [`features/0001`](../features/0001-stable-field-ids-and-safe-bulk-save.md), but the two paths should agree — probably by archiving here too, with a confirmation that says how many answers are affected |
| No UI for archived fields | A field archived by a save is invisible to its owner except as a toast at save time and a column in the responses table. No list, no un-archive, no way to tell an archived column from a live one in the dashboard |
| The bulk save's concurrency guard is untested | The `SELECT … FOR UPDATE` in the bulk handler is what stops a response submitted mid-save from having its answer cascaded away. Nothing exercises it — a real test needs two connections and deliberate interleaving |
| Nothing exercises a migration against a database that already holds data | CI applies migrations to a fresh database only, so a migration that is fine on empty tables and wrong on populated ones passes |
| Virus scanning on uploads | Files are stored and served back from our own origin |
| Real readiness probe | `/health` returns `ok` with the database down |

## Repository housekeeping

| Item | Status |
|---|---|
| `origin/feature/sprint-3-public-forms` | Merged to `main` via PR #3, still alive on the remote. Delete or keep as history — needs a decision |
| Verify the full suite passes | `npm run test:all` has not been confirmed green in a clean checkout since the docs overhaul. Frontend (237), backend (63) and integration (14) are green on `feature/0001`; E2E has not been run |
| One unexplained one-off failure in the mocked backend suite | `tests/forms.spec.ts > DELETE /api/forms/:id > should delete form` failed once during `feature/0001` and has not recurred in ~80 full-suite runs since. It mocks only `form.findFirst` and `form.delete`. The two rate-limit flakes that used to share this row were traced during `feature/0003` to assertions depending on limiter hit-counts the test did not control; they now assert the effective limit from the `RateLimit-Policy` header instead, and 50 consecutive full-suite runs are clean. If this one recurs, suspect the same class: a mocked-suite test asserting on state shared through the module-level `app` |
| Two abandoned bulk-fix commits on `develop` (`fb8acd8`, `771b77c`) | The apply-then-revert pair is already on the remote; net effect is zero, left alone rather than rewriting shared history |
