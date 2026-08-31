# CLAUDE.md

Instructions for Claude Code sessions in this repository. Read this before changing anything structural.

## What this is

**VuePDF Forms** — a micro-SaaS that turns a PDF into a fillable online form and collects structured responses. Vue 3 SPA plus an Express/Prisma/PostgreSQL API, in an npm-workspaces monorepo.

It is being built to be sold, B2B and B2C. That changes what "done" means: data loss, missing authorization and unbounded public endpoints are not backlog items to get to eventually — they are the product not working.

## Read this before deciding anything

`docs/sot/` is the Source of Truth, and it is written to be read by a session with no memory. Start at [`docs/sot/README.md`](docs/sot/README.md).

| You are about to | Read first |
|---|---|
| Change the data model | [03-domain-model](docs/sot/03-domain-model.md) — especially the cascade map |
| Add or change an endpoint | [04-backend-patterns](docs/sot/04-backend-patterns.md), [06-api-reference](docs/sot/06-api-reference.md) |
| Add frontend state | [05-frontend-patterns](docs/sot/05-frontend-patterns.md) |
| Touch auth, permissions, or anything public | [07-security-and-privacy](docs/sot/07-security-and-privacy.md) |
| Touch config, CI, or deployment | [08-operations](docs/sot/08-operations.md) |
| Write tests, or decide a change is done | [09-quality-and-testing](docs/sot/09-quality-and-testing.md) |
| Build anything toward multi-tenancy or billing | [10-saas-roadmap](docs/sot/10-saas-roadmap.md) |

Live backlog: [`docs/BACKLOG.md`](docs/BACKLOG.md) — *what is missing*. Build order: [`10-saas-roadmap`](docs/sot/10-saas-roadmap.md#build-order) — *what is next*. **Pick the next task from the build order, not from the backlog's priority column**, and when the two disagree the chain wins: a priority is a judgement, a dependency is not. Specs for work in flight: [`features/`](features/README.md).

`docs/archive/` is retired and known to contain false statements. Never cite it.

## Skills

In `.claude/skills/`. Use them instead of improvising an equivalent process.

| Skill | When |
|---|---|
| `backend-endpoint-pattern` | Any route work in `backend/src/routes/` |
| `frontend-state-pattern` | Any new store, composable or service in `frontend/src/` |
| `prisma-schema-migration` | Any change to `backend/prisma/schema.prisma` |
| `api-contract-guard` | Before documenting an endpoint, or when frontend and backend disagree |
| `sot-sync` | After any structural change, before calling it done |
| `feature-spec-writer` | Writing a spec in `features/`, and starting its branch |
| `ship-checklist` | Before opening a PR or reporting work finished |

## Agents

In `.claude/agents/`. All read-only except `test-author`.

- **`sot-auditor`** — audits `docs/sot/` against the code and reports drift with `file:line` evidence.
- **`saas-readiness-reviewer`** — reviews a branch for data loss, missing authorization, tenancy leaks, unprotected public surfaces, new personal data, and tests that cannot catch the bug they claim to.
- **`test-author`** — writes tests at the correct level, including the database-backed tests that a mocked Prisma cannot replace.

## Commands

```bash
npm run dev                      # both workspaces (docker-compose up -d first, for PostgreSQL)
npm run test:frontend            # Vitest, 38 specs / 313 tests beside the source
npm run test:backend             # Vitest + supertest over a mocked Prisma, 14 specs / 174 tests in backend/tests/
npm run test:integration         # Vitest + supertest over a REAL PostgreSQL, 10 specs / 111 tests in backend/tests/integration/
npm run test:e2e                 # Playwright, 50 tests; starts both apps itself
npm run build --workspace=frontend   # includes vue-tsc type checking
cd backend && npx tsc --noEmit       # backend type check
cd backend && npm run typecheck:tests # checks tests/fixtures/ against the Stripe SDK's own types
```

This repository requires Node **`>=22.12.0`** (see `.nvmrc`). It is enforced, not suggested: `npm ci` fails on an older Node, and every test/build script runs `scripts/check-node.mjs` first — which also verifies that the generated Prisma client and the native `re2` binary load. If something looks inexplicably broken, run `npm run check:node`.

`npm run lint` exists but lints nothing — there is no ESLint config in the repo. Do not treat a passing `lint` as a signal.

## Hard rules

1. **Never assert a fact about this code from memory or inference. Open the file.** A wrong claim in the SoT is worse than no claim, because the next session trusts it.
2. **Commits carry no `Co-Authored-By` trailer and no AI-authorship marker.** Explicit decision of the repository owner.
3. **Branch from `develop` with `--no-track`:**
   ```bash
   git checkout --no-track -b feature/NNNN-slug origin/develop
   ```
   Without `--no-track` the new branch's upstream is `origin/develop` itself, and a later push lands directly on `develop`, skipping the PR. Never commit on `develop` or `main`.
4. **Creating a local branch needs no confirmation. Pushing, opening a PR, and deleting a remote branch do** — every time.
5. **Before writing any `delete`, `deleteMany` or new cascade,** check the cascade map in [03-domain-model](docs/sot/03-domain-model.md) and answer: what customer data does this destroy, and did the user ask for that? Editing something is not consent to delete data collected through it.
6. **A mocked Prisma client cannot test database behaviour.** Cascades, constraints and rollbacks need a real PostgreSQL — that is what `backend/tests/integration/` is for (`npm run test:integration`). A green mocked test against broken code is how this project's data-loss defect shipped.
7. **File what you find.** A risk noticed while doing something else goes into `docs/BACKLOG.md` with a priority and a why — not into a sentence in the chat that disappears.
8. **Report outcomes as they are.** If tests fail, show the output. If part of the task was skipped, say which part and why. Do not describe partial work as finished.

## Current state, in one paragraph

Auth, form CRUD, the field editor, AcroForm extraction and embedding, the public form flow, the responses dashboard and CSV export all work. The bulk-save data-loss defect is fixed ([`features/0001`](features/0001-stable-field-ids-and-safe-bulk-save.md)): field ids are stable across saves, the editor's save is a diff, and deleting a field that holds answers archives it (`Field.deletedAt`) instead of destroying them. Prisma migrations are baselined; every schema change goes through `migrate dev` / `migrate deploy`. The three unauthenticated write paths are rate limited per IP (`backend/src/middleware/rateLimit.ts`); note that this depends on `TRUST_PROXY_HOPS` being right for the deployment. Author-supplied field `pattern`s are compiled by RE2 through `backend/src/services/pattern-validator.ts` — never `new RegExp` at a call site — which removes the ReDoS surface and the 500-on-invalid-pattern defect. Uploaded PDFs are no longer served by `express.static`: they come only from `GET /uploads/pdfs/:token/:filename`, whose token is minted per read by `backend/src/services/pdf-url.ts` and expires after `UPLOAD_URL_TTL_SECONDS` ([`features/0006`](features/0006-signed-expiring-urls-for-uploaded-pdfs.md)) — the URL stored in `Form.pdfUrl` is always the unsigned canonical one, never a signature. Security headers are set by `helmet` in `backend/src/app.ts` and the SPA carries a CSP built at build time in `frontend/vite.config.ts` ([`features/0007`](features/0007-security-headers-and-csp.md)) — note that a CSP on API responses would govern nothing, which is why there deliberately is not one, and that the PDF route overrides `Cross-Origin-Resource-Policy` because the SPA is a different origin. Sessions are a 15-minute access token held **in memory** by the SPA plus a rotating, revocable refresh token in an `httpOnly` cookie, backed by the `refresh_tokens` table ([`features/0008`](features/0008-session-hardening.md)) — logout revokes server-side, replaying an exchanged token kills the whole family, and the two cookie-authenticated routes (`/api/auth/refresh`, `/api/auth/logout`) are the only ones carrying a CSRF guard, because every other route authenticates with a header that cannot be set cross-site. **Forms are owned by an `Organization`, not a `User`** ([`features/0009`](features/0009-organizations-own-resources.md)): every authorization check resolves a `Membership`, `Form.createdByUserId` is provenance and never an authorization input, and a cross-tenant read is a `404` rather than a `403`. Registration creates a personal organization transactionally, so a B2C account is just an organization with one member. `Membership.role` is **stored but not enforced**, and deleting a user no longer destroys their forms — check the cascade map before assuming otherwise. Members join through an **invitation link the inviter copies and sends themselves** — there is no email service anywhere in this repo — which expires, is single-use and revocable, and refuses to be accepted by an address other than the one it names ([`features/0010`](features/0010-member-invitations-and-role-enforcement.md)). `Membership.role` **is** enforced now, by `requireRole` in `backend/src/middleware/membership.ts`, and an organization can never be left without an owner. Note the two rejection codes: not a member is `404`, a member with the wrong role is `403`. **Plans and entitlements are built** ([`features/0012`](features/0012-plan-catalogue-and-entitlements.md)): the catalogue is a frozen constant in `backend/src/services/plans.ts` (never a table), `Organization.planKey` says which entry applies until `Subscription` exists, and every limit is an explicit call from `backend/src/services/entitlements.ts` inside the handler — never middleware. Three things about it are easy to get wrong and are the reason it is spelled out here: **publishing is metered, not creating** (the design meters forms *published at once*, so drafting is free and unpublishing frees a slot); **`402` means a plan limit and `403` means a permission failure**, and they are never collapsed; and **a `402` must never reach a respondent** — the public form answers `404` and the public submit answers `403` with the wording a closed form gets, because a respondent is not the customer and the owner's billing state is not public. The response meter is `UsageCounter`, one row per organization per UTC month, claimed by an atomic upsert-and-compare inside the submission's transaction; it counts submissions *accepted in the period*, so deleting a form does not refund the month and it will legitimately disagree with `SELECT count(*)`. The seat limit (`assertCanInvite`) and `Plan.hasBranding` are written and tested but **deliberately not wired**, and billing did not change that: `assertCanInvite` waits for **Team** rather than for billing in general, because Free and Pro both have one seat and wiring it would answer `402` to every invitation from every account; `hasBranding` is now genuinely unblocked and was left out only because removing the mark is a change to the public form with its own tests. Because one published form is not a workable development environment, **`DEV_PLAN_KEY` forces every organization onto one plan** — `dev` for no limits at all, or `free`/`pro`/`team` to drive the limit screens on purpose. It is temporary, it is honoured **only when `NODE_ENV` is exactly `development` or `test`** (an allowlist, so a missing `NODE_ENV` enforces limits rather than lifting them), and the three test configurations pin it off because `app.ts` loads `.env` into every suite ([08-operations](docs/sot/08-operations.md)). **Billing is built, Free ↔ Pro only** ([`features/0013`](features/0013-stripe-subscriptions.md)). `Subscription` records the Stripe relationship and `StripeEvent` is what makes the webhook idempotent — its primary key *is* Stripe's `event.id`, because delivery is at-least-once. `backend/src/services/stripe.ts` is the **only** module that imports the Stripe SDK, and it is the **only** writer of `Organization.planKey`, which stayed exactly where it was: `getEntitlements`, `effectivePlan` and `assertCanPublishForm` were not changed at all, so no limit check joins a billing table and there is one answer to "which plan is this?". Five things about it are easy to get wrong. The **webhook is mounted above `app.use(express.json())`** and must stay there — Stripe signs the raw bytes, and under the JSON parser every signature check fails silently and totally, leaving subscriptions bought and never activated. **Returning from Checkout is not proof of payment**; nothing grants a plan except the webhook, and the Settings screen only says activation is in progress and re-reads entitlements. **The handler is state-setting, never incremental** — it writes what the event says, which is what makes it safe under replay and reordering. **A downgrade unpublishes nothing and deletes nothing**: five published forms stay published on a drop to free, and only the sixth is refused. And **`past_due` keeps the paid plan**, because Stripe retries for days and cutting someone off over an expired card is premature; the status→plan map is an allowlist, so a status this code has never heard of falls to free. Prices are **not** in the code and never will be — the amount lives in Stripe, the application stores a price id (`STRIPE_PRICE_PRO`), and no screen renders a figure that did not come from the API. All three Stripe variables are optional: unset means billing is simply off and the routes answer `503`. **`DEV_PLAN_KEY` wins over a real subscription**, so it must be empty when testing billing. There is no Team plan (it is per-seat, and that quantity has to track `Membership`), no tax handling, and no public API, email delivery, structured logging, object storage or lint. **The visual design is built** except for its commercial parts — the canvas is recorded with its tokens in [`05-frontend-patterns §8`](docs/sot/05-frontend-patterns.md), and what it draws that the app does not have is listed there: the prices, every purchase action, the organization switcher, the API keys tab, and the landing page. The landing's technology is an open decision, laid out in [`02-architecture`](docs/sot/02-architecture.md).
