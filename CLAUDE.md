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

Live backlog: [`docs/BACKLOG.md`](docs/BACKLOG.md). Specs for work in flight: [`features/`](features/README.md).

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
npm run test:frontend            # Vitest, 29 specs / 237 tests beside the source
npm run test:backend             # Vitest + supertest over a mocked Prisma, 10 specs / 98 tests in backend/tests/
npm run test:integration         # Vitest + supertest over a REAL PostgreSQL, 2 specs / 14 tests in backend/tests/integration/
npm run test:e2e                 # Playwright, 34 tests; starts both apps itself
npm run build --workspace=frontend   # includes vue-tsc type checking
cd backend && npx tsc --noEmit       # backend type check
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

Auth, form CRUD, the field editor, AcroForm extraction and embedding, the public form flow, the responses dashboard and CSV export all work. The bulk-save data-loss defect is fixed ([`features/0001`](features/0001-stable-field-ids-and-safe-bulk-save.md)): field ids are stable across saves, the editor's save is a diff, and deleting a field that holds answers archives it (`Field.deletedAt`) instead of destroying them. Prisma migrations are baselined; every schema change goes through `migrate dev` / `migrate deploy`. The three unauthenticated write paths are rate limited per IP (`backend/src/middleware/rateLimit.ts`); note that this depends on `TRUST_PROXY_HOPS` being right for the deployment. Author-supplied field `pattern`s are compiled by RE2 through `backend/src/services/pattern-validator.ts` — never `new RegExp` at a call site — which removes the ReDoS surface and the 500-on-invalid-pattern defect. Uploaded PDFs are no longer served by `express.static`: they come only from `GET /uploads/pdfs/:token/:filename`, whose token is minted per read by `backend/src/services/pdf-url.ts` and expires after `UPLOAD_URL_TTL_SECONDS` ([`features/0006`](features/0006-signed-expiring-urls-for-uploaded-pdfs.md)) — the URL stored in `Form.pdfUrl` is always the unsigned canonical one, never a signature. There are no organizations, plans, billing, public API, security headers, structured logging, object storage or lint.
