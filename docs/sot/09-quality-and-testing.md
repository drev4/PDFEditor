# Quality and testing


### The E2E suite starts its own backend, always

`playwright.config.ts` sets `reuseExistingServer: false` for the **backend** and leaves it on for the frontend. The asymmetry is the point: the backend `webServer` entry passes `RATE_LIMIT_*: 100000`, and a dev backend already listening on `:3000` does not have them. Adopting one makes registration hit the real limiter, and roughly 28 tests then fail on a `waitForURL` timeout that looks exactly like an application bug — it was diagnosed three times in one session before the cause was found. The SPA carries no test-only configuration, so adopting a dev server there is harmless.

The cost is that a leaked server from a previous run makes the next run fail to start rather than fail mysteriously. That is the trade being made on purpose.

## What exists

| Level | Count | Tooling | Location |
|---|---|---|---|
| Frontend unit / component | 59 specs, 513 tests | Vitest, `@testing-library/vue`, `@pinia/testing`, jsdom (`frontend/vitest.config.ts`) | Beside the code, `frontend/src/**/*.spec.ts` |
| Backend route (mocked Prisma) | 32 specs, 403 tests | Vitest, `supertest`, `vitest-mock-extended` | `backend/tests/*.spec.ts` |
| **Backend database-backed** | 30 specs, 274 tests — 3 specs (10 tests) skip themselves without `TEST_REDIS_URL`, see below | Vitest, `supertest`, **real PostgreSQL** (`backend/vitest.integration.config.ts`) | `backend/tests/integration/*.spec.ts` |
| End to end | 8 specs, 54 tests | Playwright, Chromium | `e2e/*.spec.ts`, helpers in `e2e/helpers.ts` |

**Two specs guard a shape rather than a behaviour**, and both are the closest thing this repository has to a lint rule while `npm run lint` lints nothing. `backend/tests/async-handler-coverage.spec.ts` reads the route sources and fails when an `async` handler is not wrapped in `asyncHandler` ([`features/0026`](../../features/0026-async-handler.md)) — because a wrapper somebody has to remember fails exactly like the `try`/`catch` it replaced. It carries a **negative control**: a fixture the scan must flag, asserted in the same file, so a regex that quietly stopped matching cannot report a clean codebase for ever. That control earned itself immediately — the first draft matched the literal `asyncHandler(` and missed `asyncHandler<ApiKeyRequest>(`.

**The suites run silent.** `LOG_LEVEL` defaults to `silent` under `NODE_ENV=test` ([`features/0025`](../../features/0025-structured-logging.md)), so anything a suite prints is its own. A test that needs to assert on a log line spies on `services/logger.ts` — `backend/tests/middleware-errorHandler.spec.ts` is the model — and `tests/process-guards.spec.ts`, which runs a real child process, sets `NODE_ENV=production` and `LOG_LEVEL=info` explicitly, so it measures the guards rather than how the runner happens to be configured.

**The suites run offline, and the storage driver is what keeps that true.** `PDF_STORAGE_DRIVER` defaults to `local`, so every suite reads and writes real files under `backend/uploads/pdfs` exactly as before — `tests/security-headers.spec.ts` writes a fixture and fetches it through the signed route, and the E2E suite uploads real PDFs. The `s3` driver is never exercised by `npm test` and that is deliberate: mocking the AWS SDK would assert that the code calls the mock the way the code calls the mock. It is verified against a real S3-compatible endpoint instead — MinIO from `docker-compose.yml` — and what that run covered is recorded in [`features/0016`](../../features/0016-object-storage-for-uploaded-pdfs.md)'s Outcome.

**The job queue is off in every suite, and the queued path has its own spec.** `REDIS_URL` is pinned empty in both vitest configs, so the PDF embed runs inline and the suites keep needing nothing but PostgreSQL — the same reasoning as the storage driver above. That leaves a real risk, because features/0017 deliberately keeps *two* implementations of one operation and only one of them is exercised by everything else. So `tests/integration/pdf-embed-queue.spec.ts` runs the queued path against a **real Redis**, asserting the same invariant as the inline concurrency spec: it skips itself unless `TEST_REDIS_URL` is set, and it sets `REDIS_URL` for its own duration and runs a worker in-process.

```bash
docker compose up -d redis
TEST_REDIS_URL=redis://localhost:6379 npm run test:integration --workspace=backend
```

Note the variable is deliberately **not** `REDIS_URL`: that name is the one pinned empty, so a developer's `.env` cannot move the other fifteen specs onto a worker that is not running.

**`REDIS_URL` now switches two subsystems, so both have a spec.** Beside the queue's, `tests/integration/rate-limit-store.spec.ts` proves the property that makes features/0018 worth having — two independently built limiters, standing in for two replicas, counting a client once — and it skips itself without `TEST_REDIS_URL` for the same reason. Note the trap it walked into first: the `login` limiter refunds successful requests (`skipSuccessfulRequests`), so a probe returning 200 never accumulates a hit and the limiter never bites; the spec uses `responses` and `register`, which have no refund.

**Webhook delivery is tested against a real receiver, not a mock.** `tests/integration/webhook-delivery.spec.ts` starts a genuine TLS server, submits a real form, lets the real worker deliver, and verifies the signature the way a customer would — from the raw body. One thing is stubbed and it is narrow: the receiver is on `127.0.0.1`, which the egress guard exists to refuse, so `assertDeliverableUrl` is replaced *in that file only*. The guard keeps its own unit spec (`tests/webhook-egress.spec.ts`, 23 cases covering every blocked address family) and `webhooks.spec.ts` asserts the API refuses that same URL, so the protection is not what goes untested — everything after it is what this file exercises.

**One rule needed a test of its own, and a review found that out.** The address pinned into the socket — the actual DNS-rebinding defence — could be deleted without any suite noticing, because the integration receiver lives at `127.0.0.1`, a hostname that resolves to itself. `tests/webhook-pinning.spec.ts` makes the two answers differ (a `.invalid` hostname that never resolves, pinned to the local server), so removing the pin fails it immediately and offline. It is the standing example of the rule this document keeps repeating: a test that would pass against the broken version is not covering the thing it names.

**The third state — `REDIS_URL` set and no Redis there — has its own spec, and it needs no Redis, so CI runs it.** `tests/integration/pdf-embed-fallback.spec.ts` points `REDIS_URL` at a refused port and then at an unroutable address (TEST-NET-1) and asserts the save still answers *and* the PDF is still embedded. The second case is the one worth having: before it existed, a Redis that neither answered nor refused made the enqueue wait for ever and the bulk save never responded, while the "falls back to inline" claim sat in a comment above the code that could not deliver it.

**One test in the database-backed suite widens a race on purpose.** `tests/integration/pdf-embed-concurrency.spec.ts` installs a storage driver that stalls the first reader *after* it has the bytes, so two overlapping bulk saves reliably interleave. Without that the lost update reproduces perhaps once in fifty runs, and a test that flaky is not a regression test. The delay is on that side of the read for a reason recorded in the file: sleeping *before* it makes the stalled request read last, get the fresher document, and pass against broken code — which is what the first draft did. Its queued twin needs one thing more, and its absence is how *that* draft passed against a worker with no lock at all: it waits until a job is genuinely **active** before making the second save. Both requests return as soon as they have enqueued, so without that wait both jobs start after both saves have committed, re-read the same final field set, and agree by accident.

The two placement conventions are different on purpose and must not be mixed: **frontend tests sit next to their subject, backend tests sit in `backend/tests/`.**

> **Node version: `>=22.22.2`, and it now applies to everything.** The frontend suite needs it because of Vite 7 and jsdom 27 (below it, every spec fails to start with `ERR_REQUIRE_ESM` and the build dies on a missing `crypto.hash`), and **the backend needs it too** — `re2` declares `engines: node ^22.22.2 || ^24.15.0 || >=26.0.0`, and on a mismatched ABI it fails to load, at which point the backend goes green on all but two tests while silently not enforcing field patterns (measured during [`features/0005`](../../features/0005-working-ci-and-enforced-node-version.md), when the suite was 83 tests). That is enforced rather than documented: `engine-strict` at install, `scripts/check-node.mjs` on every test and build script, and `node-version-file: .nvmrc` in CI. See [08-operations](./08-operations.md#the-supported-node-version).

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

### Testing a race, where `Promise.all` is the assertion

`tests/integration/plan-limit-races.spec.ts` is the reference ([`features/0027`](../../features/0027-atomic-plan-limits.md)). Three rules came out of writing it, and every one of them is a way to produce a test that passes against broken code.

**The requests must overlap.** `await invite(a); await invite(b)` is two requests one after the other and it passes against the unfixed code — the second one counts the row the first one committed. The window being tested is between a check and a write, and the only way to be inside it is to be there at the same time, so the calls go through one `Promise.all` and the assertion is on the *set* of statuses: exactly one `201` and one `402`, never a specific request winning. Which one wins is a race and asserting it would be flaky.

**It cannot be a mocked test.** A mocked Prisma has no lock, no transaction and no second connection; it would report both requests succeeding and both failing identically. `tests/mock-transaction.ts` now says this about itself in the comment on `passThroughTransactionOnly`, because the mocked suite *does* exercise these routes and a reader could reasonably think it covers them.

**Assert the rows, not only the statuses.** A handler can answer `402` and still have written. Each race test finishes with the `count` that the plan limit is about.

Timing-dependent tests earn their keep only if they are known to fail against the bug, so **run them against the unfixed code and see them fail** — `git stash push -- backend/src` is enough. The three race tests here failed that way before the fix and pass after it. The fourth, which holds a `FOR UPDATE` on one organization's row and asserts a publish in a *different* organization does not wait on it, passes either way today: it is a guard on the fix's scope rather than a reproduction of the bug, and it is what stops "serialise everything" from being an acceptable answer later.

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

## The suites do not read your `.env`, and that is on purpose

`backend/src/app.ts` calls `dotenv.config()`, and every backend spec imports `app.ts`. So whatever is in `backend/.env` **is** in `process.env` while the tests run, including settings that change the behaviour under test.

This is not hypothetical: adding `DEV_PLAN_KEY=dev` to a local `.env` turned plan enforcement off inside the suites and four tests in `tests/entitlements.spec.ts` failed — the tests were right and the environment was wrong, which is the confusing direction for that to happen in.

Anything that can switch a behaviour off is therefore **pinned in the test configuration**, not left to the environment: `backend/vitest.config.ts`, `backend/vitest.integration.config.ts` and `playwright.config.ts` all set `RATE_LIMIT_*` high and `DEV_PLAN_KEY: ''`, and **all three** now pin `REDIS_URL: ''` — `playwright.config.ts` joined the list in features/0018, because `REDIS_URL` had stopped meaning only “the embed moves to a worker nobody started” and started also meaning “rate limiting fails closed if that Redis is not there” — a local `REDIS_URL` would otherwise queue every embed onto a worker no suite is running, and every embed assertion would be measuring a document nothing ever wrote. Set it to the empty string rather than leaving it out — dotenv fills in a key that is absent from `process.env` and leaves alone one that is already there.

**Add a line to all three whenever you add a setting that can disable something.** A suite that passes because a feature was switched off is worse than a failing one.

## Where a test belongs

| Question the test answers | Level |
|---|---|
| Does this pure function compute the right value? | Unit, beside the code |
| Does this endpoint validate, authorize and respond correctly? | `backend/tests/`, `supertest` over a mocked Prisma |
| **Does the database do what this handler assumes** — cascades, constraints, transactions? | `backend/tests/integration/`, against a real PostgreSQL |
| Do two requests arriving at once leave the data correct? | `backend/tests/integration/`, and nowhere else — a mock has no lock and no second connection |
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
| **The Redis-backed paths are not in CI** | `pdf-embed-queue.spec.ts`, `rate-limit-store.spec.ts` and `webhook-delivery.spec.ts` all skip unless `TEST_REDIS_URL` is set, and no workflow sets it. All three are verified by hand and locally; one Redis service in the integration job would close this for all of them — and it matters more now that webhook delivery, which cannot run inline at all, is one of them |

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
