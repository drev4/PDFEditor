# Quality and testing

## What exists

| Level | Count | Tooling | Location |
|---|---|---|---|
| Frontend unit / component | 29 specs, 241 tests | Vitest, `@testing-library/vue`, `@pinia/testing`, jsdom (`frontend/vitest.config.ts`) | Beside the code, `frontend/src/**/*.spec.ts` |
| Backend route (mocked Prisma) | 12 specs, 115 tests | Vitest, `supertest`, `vitest-mock-extended` | `backend/tests/*.spec.ts` |
| **Backend database-backed** | 5 specs, 43 tests | Vitest, `supertest`, **real PostgreSQL** (`backend/vitest.integration.config.ts`) | `backend/tests/integration/*.spec.ts` |
| End to end | 7 specs, 38 tests | Playwright, Chromium | `e2e/*.spec.ts`, helpers in `e2e/helpers.ts` |

The two placement conventions are different on purpose and must not be mixed: **frontend tests sit next to their subject, backend tests sit in `backend/tests/`.**

> **Node version: `>=22.12.0`, and it now applies to everything.** The frontend suite needs it because of Vite 7 and jsdom 27 (below it, every spec fails to start with `ERR_REQUIRE_ESM` and the build dies on a missing `crypto.hash`), and **the backend needs it too** — `re2` declares `engines: node >=22`, and on a mismatched ABI it fails to load, at which point the backend goes green on all but two tests while silently not enforcing field patterns (measured during [`features/0005`](../../features/0005-working-ci-and-enforced-node-version.md), when the suite was 83 tests). That is enforced rather than documented: `engine-strict` at install, `scripts/check-node.mjs` on every test and build script, and `node-version-file: .nvmrc` in CI. See [08-operations](./08-operations.md#the-supported-node-version).

## Backend: integration tests over the real router

Backend specs drive the actual Express app with `supertest` and mock only the two edges — the database and authentication:

```ts
vi.mock('../src/services/db', async () => {
  const { mockDeep } = await import('vitest-mock-extended')
  return { prisma: mockDeep<PrismaClient>() }
})

vi.mock('../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => { req.userId = 'user-1'; next() }
}))

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>
beforeEach(() => { mockReset(prismaMock) })
```

This is a good trade: routing, Zod validation, ownership logic, status codes and the error handler are all genuinely exercised, while the tests stay fast and need no database.

It has one failure mode worth naming, because the project's data-loss defect lived in exactly that blind spot: **a mocked Prisma cannot show you what the database would actually do.** `deleteMany` on a mock has no cascade, so a test asserting "bulk save replaces the fields" passed cheerfully while the real database deleted every answer. Referential behaviour — cascades, constraints, transaction rollback, unique violations — needs a real PostgreSQL. That level now exists.

## Backend: database-backed tests

`backend/tests/integration/` runs the same `supertest`-over-the-real-router approach with **nothing mocked** — a real PostgreSQL, real Prisma, real JWTs signed with the test secret.

```bash
npm run test:integration                       # from the repo root
npm run test:integration --workspace=backend   # or from the workspace
```

- Config: `backend/vitest.integration.config.ts`. Separate from `vitest.config.ts`, which excludes `tests/integration/**` so the mocked suite stays fast and database-free.
- `DATABASE_URL` defaults to `postgresql://postgres:postgres@localhost:5432/vuepdf_test`. Create it once and apply migrations: `npm run db:migrate:deploy` with that URL.
- `tests/integration/setup.ts` truncates every table before each test; `helpers.ts` builds users, tokens, forms, fields and responses.
- Files run one at a time (`fileParallelism: false`) — they share one database.
- CI runs it as its own job against a `postgres:16` service (`.github/workflows/test.yml`).

Put a test here when the assertion is about **what the database does**, and only then. Validation, status codes and ownership belong in the mocked suite, which is an order of magnitude faster.

### Testing something configured by the environment

`backend/tests/rate-limit.spec.ts` is the reference. It sets the limits with `vi.stubEnv`, through the same `process.env` path production reads, rather than importing the limiter and changing its numbers — a test that reaches past the configuration is no longer testing what a deploy will do. It also resets the shared limiter state around every test, because the suites share one `app` and hit counts otherwise leak between tests.

The general rule: **configure the unit the way production configures it.** If that is awkward, the awkwardness is telling you something about the configuration path.

One environment variable is not what you expect under Vitest. **Vitest mirrors Vite's `import.meta.env` into `process.env`, and Vite always defines `BASE_URL`** — as `/`, the public base path. So `process.env.BASE_URL || 'http://localhost:3000'` resolves to `/` in every backend spec, and any code that builds an absolute URL from it produces `//uploads/...` instead. Both vitest configs now pin `BASE_URL` to `http://localhost:3000` in their `env` block for this reason. If a new variable ever shares a name with something Vite defines, expect the same surprise.

## End to end: every test creates the data it needs

The rule, and it is the whole reason this suite is trustworthy now: **an E2E test creates the data it needs and shares no identifier with any other test.** No fixed email, no fixed `shareId`, no dependence on a clean database or on what ran before.

`e2e/helpers.ts` is the seam that makes that cheap:

| Helper | Use |
|---|---|
| `registerNewUser(page)` | Registers a fresh account through the UI and lands on `/dashboard` |
| `loginUser(page, user)` | Logs an existing user in through the UI |
| `createPublishedForm(request)` | Seeds a published form with one field **over the HTTP API**, returns its `shareId` |
| `uniqueEmail(prefix)` | `Date.now()` **plus** a uuid fragment |

Never inline a registration block again — that is what broke the suite for months ([`features/0003`](../../features/0003-e2e-suite-green-and-independent.md)). Every test in a describe shared one module-scope email, so the second registration returned `400 Email already registered`, the app stayed on `/register`, and the following `waitForURL` timed out. `Date.now()` alone is not unique: parallel workers import a module in the same millisecond.

`createPublishedForm` goes through the API rather than Prisma on purpose. A database seed skips the routes, and this suite exists to exercise them — a Prisma seed would have sailed through the bulk-save data-loss defect of [`features/0001`](../../features/0001-stable-field-ids-and-safe-bulk-save.md), which lived in a handler.

**Prefer `data-testid` over visible copy.** Several failures were assertions on text the app had never rendered, and one on a `.pdf-viewer` class that does not exist (it is `pdf-viewer-container`; a CSS selector matches whole class tokens, so the two never matched). A test that breaks when someone rewords a button is a test people learn to ignore.

**A test must be able to fail for the reason its name gives.** Seven tests in `pdf-workflow.spec.ts` had names about upload, viewer rendering and toolbars, and bodies that only asserted `.dashboard-view` was visible. They reported coverage that did not exist, which is worse than no test. They are now three that assert what they claim, one of which genuinely uploads a PDF.

Verify independence, not just a green run:

```bash
npm run test:e2e -- --workers=1     # the CI setting
npm run test:e2e                    # parallel
npm run test:e2e                    # again, WITHOUT resetting the database
npm run test:e2e -- --repeat-each=2 # order and state sensitivity
```

Rate limits are set for the suite in `playwright.config.ts` under `webServer.env`, because every test registers a user and the register limiter defaults to 5/hour ([`features/0002`](../../features/0002-rate-limiting-on-public-write-paths.md)). A clean checkout needs no local setup.

## Frontend: behaviour, not internals

Assert what a unit caused, not how it is built:

```ts
expect(api.post).toHaveBeenCalledWith('/forms/form-1/fields', mockFieldData)
```

Test stores and composables through their public surface — call an action, assert the resulting state and the requests made. Do not reach into internal refs when an observable effect says the same thing, and do not mount a whole view to test logic that lives in a composable.

## Where a test belongs

| Question the test answers | Level |
|---|---|
| Does this pure function compute the right value? | Unit, beside the code |
| Does this endpoint validate, authorize and respond correctly? | `backend/tests/`, `supertest` over a mocked Prisma |
| **Does the database do what this handler assumes** — cascades, constraints, transactions? | `backend/tests/integration/`, against a real PostgreSQL |
| Does a store or composable produce the right state and requests? | Frontend unit |
| Does a full user journey work across both apps? | Playwright E2E |
| Does the PDF that comes out actually have the fields where the editor put them? | **No test exists at any level** |

The last row is the remaining coverage gap of this kind: nothing verifies the canvas-versus-PDF scale coupling from [02-architecture.md](./02-architecture.md).

## Gaps

| Gap | Consequence |
|---|---|
| **No ESLint at all.** The root `npm run lint` calls `--workspaces --if-present`, and no workspace defines a `lint` script. There is no `eslint.config.js` | The lint command silently succeeds while linting nothing, which is worse than having no command |
| **No type check in CI.** `vue-tsc` and `tsc` only run inside builds, and CI never builds | Type errors reach `develop` |
| **No PDF round-trip test** | Nothing verifies that embedded AcroForm positions match what the editor showed |
| **Coverage collected but not enforced** | Coverage can fall silently; Codecov failures are ignored |
| **Database-backed coverage is narrow** | Only the bulk save and archived-field visibility are covered. Form deletion, response submission and the `syncFieldsFromPDF` side effect still have no real-database test |

When lint is added, use flat config (`eslint.config.js`) — the rest of the toolchain is on versions that assume it.

## Definition of done

A change is done when all of these are true. This is the checklist the `ship-checklist` skill runs before a PR.

1. The change does what its `features/` spec or issue said, and nothing else. Scope that grew is either removed or acknowledged in the PR description.
2. **Tests were added at the level that would have caught the bug.** For a fix, that means a test that fails without the change — write it first and watch it fail.
3. `npm run test:frontend`, `npm run test:backend`, `npm run test:integration` **and `npm run test:e2e`** pass. All of them, every time — a feature is not finished while any suite is red, including failures that predate the branch.
4. Type checking passes in both workspaces: `npm run build --workspace=frontend` and `npx tsc --noEmit` in `backend/`.
5. The API contract is unchanged, or [06-api-reference.md](./06-api-reference.md) was updated **after re-reading the route file** (`api-contract-guard`).
6. Schema changes carry a migration and an explicit written statement of the `onDelete` behaviour of every new relation ([03-domain-model.md](./03-domain-model.md)).
7. New personal data is recorded in the inventory in [07-security-and-privacy.md](./07-security-and-privacy.md); new public endpoints have rate limiting.
8. Affected SoT documents are updated in the same commit (`sot-sync`), and new debt created by the change is filed in [`docs/BACKLOG.md`](../BACKLOG.md) rather than left in someone's head.
9. Commit messages follow [11-conventions.md](./11-conventions.md), with no AI-authorship trailer.

## Review priorities

In order. A reviewer who only has time for the first two is still adding most of the value.

1. **Can this destroy or expose customer data?** Cascades, bulk writes, missing ownership checks, anything newly public.
2. **Is the failure mode acceptable?** What happens on a partial write, a timeout, a malformed PDF, a duplicate submit.
3. **Does it match the patterns in [04](./04-backend-patterns.md) and [05](./05-frontend-patterns.md)?** Divergence is a question to ask, not automatically a defect — but it must be a decision.
4. **Is the test at the right level**, and would it have caught the bug it claims to fix?
5. Naming, structure, readability.
