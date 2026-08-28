# 0003 — An E2E suite that is green and whose tests are independent

**Status:** done
**Priority:** P0 (see [`docs/BACKLOG.md`](../docs/BACKLOG.md))
**Branch:** `feature/0003-e2e-suite-green-and-independent`
**Related:** [`09-quality-and-testing`](../docs/sot/09-quality-and-testing.md) · [`08-operations`](../docs/sot/08-operations.md) · [`05-frontend-patterns`](../docs/sot/05-frontend-patterns.md)

## Context

The Playwright suite is 38 tests across six files in `e2e/`. It does not pass, and has not passed for a long time. On an unmodified `develop` checkout, a local run fails 11 of 38; a second run fails 9, with a partly different set. CI, which runs `workers: 1`, fails more than either.

That makes it worse than no suite. A red suite gates nothing: a genuine regression lands inside the noise and nobody can tell it apart from the usual failures. Every feature that is supposed to finish green is currently blocked by it, which is why this is the item ahead of the rest of P0.

The failures are **not** flaky in the usual sense, and they are not caused by the application being broken. They are three concrete defects in the tests themselves, each verified below against the real code and a real server. This is a test-repair job, not a debugging expedition.

## The three root causes

### A. Every test in a describe registers the *same* email

Six places compute an email once, at module load, then register it again for every test in the block:

| Where | Registers in | Tests that re-register |
|---|---|---|
| `e2e/auth-flow.spec.ts:4` | each test body | `:8`, `:31`, `:67`, `:92` |
| `e2e/form-management.spec.ts:4` | `beforeEach` at `:10` | all 4 |
| `e2e/form-management.spec.ts:51` | `beforeEach` at `:55` | both |
| `e2e/form-management.spec.ts:89` | one test body | only 1 — this block passes |
| `e2e/pdf-workflow.spec.ts:4` | `beforeEach` at `:8` | all 5 |
| `e2e/pdf-workflow.spec.ts:76` | `beforeEach` at `:80` | both |

The backend rejects the second and later registrations. Verified against a running server:

```
register #1 -> {"user":{"id":"198a65bc-…","email":"dup-check-20995@example.com",…}}
register #2 -> {"error":"Email already registered"} [400]
```

That is `backend/src/routes/auth.ts:36-38`. The frontend then stays on `/register`, so the `await page.waitForURL(/\/dashboard/)` that follows every one of those registrations times out, and the test fails there rather than at the assertion it was written for.

**This also explains the "flakiness", which is not flakiness.** `playwright.config.ts` sets `fullyParallel: true` with `workers` unset locally, so Playwright uses several workers. Each worker imports the spec module separately, so `Date.now()` — and therefore the email — differs per worker. Two tests from one describe collide only when they land in the same worker, and worker assignment varies between runs. That is the entire mechanism behind the changing failure set. In CI `workers: 1` means one module instance per file and every collision fires. Measured on this branch with `--workers=1`: **11 failed, 27 passed** — 8 of them from this cause, showing as 6 × `page.waitForURL` timeout plus 5 × timeout inside a `beforeEach` hook.

### B. `public-form-flow.spec.ts` depends on a form that has never existed

`e2e/public-form-flow.spec.ts:6`:

```ts
// Note: This test relies on a form with shareId '53SGWRKS0N8E' being present in the DB
// and having at least one text field.
const shareId = '53SGWRKS0N8E';
```

Nothing creates it. Verified: `SELECT count(*) FROM forms WHERE share_id='53SGWRKS0N8E'` returns **0**. The comment is an accurate description of a test that cannot pass on any machine that did not happen to have that row. `page.goto` still returns 200 because the SPA shell loads, so the failure surfaces later as `waitForSelector('.pdf-viewer')` timing out — which reads like a rendering bug and is not one.

### C. Three assertions reference text the application does not render

Even with A and B fixed, these fail:

| Assertion | Reality |
|---|---|
| `public-form-flow.spec.ts:41` — `text=Preview your answers` | The dialog header is **"Review Your Responses"** (`frontend/src/components/forms/SubmitPreviewModal.vue:6`) |
| `public-form-flow.spec.ts:44` — `button:has-text("Confirm Submission")` | The button label is **"Confirm and Submit"** (`SubmitPreviewModal.vue:63`) |
| `pdf-workflow.spec.ts:21` — `h2:has-text("Welcome to PDF Editor")` | `DashboardView.vue:121-122` renders **"Welcome back"**. The string "Welcome to PDF Editor" exists only in `RegisterForm.vue` |

### D. `.pdf-viewer` is not a class that exists

Found while executing this spec, which is why the prompt says to confirm the causes rather than trust the document.

`e2e/public-form-flow.spec.ts:18` and `:56` wait for `.pdf-viewer`. The only class in the codebase is **`pdf-viewer-container`** (`frontend/src/components/pdf/PDFViewer.vue:2`), and a CSS class selector matches whole tokens — `.pdf-viewer` does not match `class="pdf-viewer-container"`. So that wait can never succeed, independently of B and C.

Beware when checking this: a grep for `pdf-viewer` *does* hit that line, because `-` is a word boundary for a regex but not for a CSS class token. Every other selector the suite uses was verified to exist:

| Selector | Status |
|---|---|
| `.pdf-viewer` | **missing** — use `.pdf-viewer-container` or a `data-testid` |
| `.pdf-viewer-container`, `.public-field-item`, `.text-input`, `.dashboard-view` | present |
| every `data-testid` used by the auth tests | present |
| "Review Your Responses", "Confirm and Submit", "Response Submitted", "PDF Editor Pro", "Logout" | present |

Note "Welcome back" appears in both `LoginForm.vue` and `DashboardView.vue:122`, so matching on that copy alone is ambiguous — prefer a `data-testid`.

## Why the obvious approach is wrong

**Adding a random suffix to the email is not the fix.** It is one line and it makes the current 38 pass, and it leaves the actual defect — tests sharing an identity through module scope — exactly where it is, so the next test added to any of those describes reintroduces it. It is also not reliably unique: two parallel workers can import a module in the same millisecond, which is a second bug of the same shape. The repair is a **fixture that hands each test its own registered user**, so that sharing is impossible rather than merely unlikely.

**Do not set `workers: 1` to stop the failure set moving around.** It would make local runs match CI, and both would still fail. Parallelism is not the defect; it only varies which collision you observe. Test independence is what makes parallelism safe, and it is the thing being fixed here.

**Do not seed a form with the hardcoded `shareId` to fix B.** It replaces "depends on a magic row someone made by hand" with "depends on a magic row we make by hand", still owned by nothing, still silently destroyed the moment another suite truncates the database. The public-form test must create the form it submits to and use the `shareId` the API returns.

**Seed that form through the API, not through Prisma and not through the editor UI.** Prisma would couple the E2E suite to the schema and skip the HTTP layer — and a Prisma seed would have kept passing straight through the bulk-save data-loss defect that [`features/0001`](0001-stable-field-ids-and-safe-bulk-save.md) fixed, because that bug lived in a route. Driving the editor UI instead would make a test about the *public* flow fail whenever the *authoring* flow breaks, which is the coupling that makes suites like this unmaintainable. Playwright's `request` fixture talks to the real API and is the right tool.

**Do not delete tests to reach green.** It is the fastest route and the backlog row's "fix or delete" wording permits it, but the two public-form tests are the *only* end-to-end coverage of a respondent submitting a form — the product's core transaction, and the flow feature 0001 changed. Deleting them would remove the check most worth having.

That said, deletion is right for a test whose name is a lie. `pdf-workflow.spec.ts:46` is called "should display PDF viewer after upload" and asserts only that `.dashboard-view` is visible, having uploaded nothing; `:34` is called "should show upload progress during PDF upload" and asserts only that an upload area exists — its own comment admits it. A test that cannot fail for the reason its name gives is worse than no test, because it reports coverage that does not exist. Each such test gets made real or deleted, deliberately, and the choice is listed in the PR description.

**One trap introduced by [`features/0002`](0002-rate-limiting-on-public-write-paths.md).** `POST /api/auth/register` is now rate limited, default 5 per hour per IP. A suite that registers a fresh user per test exceeds that immediately. CI already sets `RATE_LIMIT_*` high for the E2E job, but a local `npm run test:e2e` uses `backend/.env` and will fail with `429` unless the developer knows to add them. Fix that here rather than documenting it: set them in `webServer.env` in `playwright.config.ts`, so a clean checkout runs green with no local setup.

## Goal

1. `npm run test:e2e` passes **38 of 38** (or the deliberately reduced count, see 6) on a clean checkout with a default `backend/.env` and no extra environment variables.
2. It passes with parallel workers **and** with `workers: 1`, the CI setting.
3. It passes **twice in a row without resetting the database**. No test may depend on a clean database, on data another test created, or on execution order.
4. No email, `shareId`, form id or other identifier is shared between two tests, and none is hardcoded to data the suite did not create in that run.
5. Registration and login helpers live in one place, so a new test cannot reintroduce cause A by copying an existing block.
6. Every remaining test can fail for the reason its name gives. Tests that cannot are either made real or deleted; the PR description lists every deletion and why.
7. The CI `e2e-tests` job is green.

## Out of scope

- **The unit, mocked-backend and database-backed suites.** All three are green and are not touched.
- **New end-to-end coverage.** This repairs what exists; it does not extend it. If the repair reveals a gap worth covering, file it.
- **Rewriting the editor tests to genuinely drive a PDF upload through the UI.** Making a vacuous test honest may mean deleting it here; building real editor coverage is its own piece of work.
- **The two unexplained one-off failures in the mocked backend suite** already tracked in [`docs/BACKLOG.md`](../docs/BACKLOG.md). Different suite, different mechanism.
- **`docs/BACKLOG.md`'s Node-version row.** Unrelated, and about the frontend unit suite.

**If a repaired test uncovers a genuine product bug**, that is a real finding, not an obstacle. Fix it on this branch if it is small, and say so in the PR description. If it is large enough to be its own feature, stop and raise it with the repository owner before continuing — do not skip the test, mark it `.fixme`, or weaken the assertion to get past it.

## Execution prompt

> **Step 1 — read before writing.** All six files in `e2e/`, and `playwright.config.ts` (note `fullyParallel: true`, `workers: 1` only in CI, and `webServer.command: 'npm run dev'`). Then the pieces the assertions depend on: `frontend/src/views/DashboardView.vue` (the welcome heading at `:121`), `frontend/src/components/forms/SubmitPreviewModal.vue` (the header at `:6` and the buttons at `:56`/`:63`), `frontend/src/views/PublicFormView.vue`, and `backend/src/routes/auth.ts:24-58` for what a duplicate registration returns. Confirm the three root causes above against the code yourself rather than trusting this document.
>
> **Step 2 — reproduce first, and record the baseline.** Run `npm run test:e2e -- --workers=1 --reporter=list` and save the output. `workers: 1` is the CI setting and makes cause A deterministic, so this is the number to improve. Every later step is judged against it. Do not start editing until you have seen the failures with your own eyes.
>
> **Step 3 — remove the local rate-limit trap.** In `playwright.config.ts`, add `env` to `webServer` setting `RATE_LIMIT_LOGIN_MAX`, `RATE_LIMIT_REGISTER_MAX` and `RATE_LIMIT_RESPONSES_MAX` high enough for a full run with retries. A clean checkout must go green without anyone editing `backend/.env`. Leave the values in `.github/workflows/test.yml` alone — they are correct, and now redundant rather than wrong.
>
> **Step 4 — one place that makes a user.** Create `e2e/helpers.ts` (or `e2e/fixtures.ts`). Export something like `registerNewUser(page)` that generates a genuinely unique email — `Date.now()` alone is not enough under parallel workers, add randomness — fills the form using the existing selectors, waits for `/dashboard`, and returns the email and password. A Playwright fixture is a good fit if you want it to run automatically. Then delete all six module-scope `const testEmail = …` declarations and route every registration through the helper, so each test gets its own user. Nothing else about those tests changes yet.
>
> **Step 5 — make the public-form test own its data.** In `e2e/public-form-flow.spec.ts`, delete the hardcoded `shareId` at `:6`. In a `beforeAll` or a fixture, use Playwright's `request` fixture against `http://localhost:3000/api` to: register an author, create a form, upload one of the PDFs already in `backend/test-fixtures/`, add at least one text field, publish it, and keep the returned `shareId`. Both tests then use that. Check the real request and response shapes in [`06-api-reference`](../docs/sot/06-api-reference.md) — and re-read the route files if anything looks off, per `api-contract-guard`. Note that the bulk field save now takes and returns stable ids ([`features/0001`](0001-stable-field-ids-and-safe-bulk-save.md)).
>
> **Step 6 — fix the three stale assertions.** `public-form-flow.spec.ts:41` → "Review Your Responses"; `:44` → "Confirm and Submit"; `pdf-workflow.spec.ts:21` → the dashboard's actual heading. Prefer a `data-testid` over matching visible copy where you touch these — copy changes, and a test that breaks on wording is a test people learn to ignore. If you add one, add it to the component too.
>
> **Step 7 — deal with the dishonest tests.** Go through `e2e/pdf-workflow.spec.ts` test by test. For each, ask whether it can fail for the reason its name gives. `:34` ("upload progress") and `:46` ("display PDF viewer after upload") cannot — they upload nothing. Make each one real or delete it. Do not leave a test that asserts `.dashboard-view` is visible under a name about PDF rendering. Record every decision for the PR description.
>
> **Step 8 — prove independence, which is the actual deliverable.** In order:
> - `npm run test:e2e -- --workers=1` — green.
> - `npm run test:e2e` (parallel) — green.
> - `npm run test:e2e` **again, without touching the database** — green. This is the one that catches a test still depending on a clean database or on another test's leftovers.
> - `npm run test:e2e -- --repeat-each=2` if it is cheap enough, for order sensitivity.
>
> **Step 9 — verify nothing else regressed.** `npm run test:frontend`, `npm run test:backend`, `npm run test:integration`, `npx tsc --noEmit` in `backend/`, `npm run build --workspace=frontend`.
>
> **Step 10 — document.** Run `sot-sync`. [`09-quality-and-testing`](../docs/sot/09-quality-and-testing.md) needs the real E2E spec count, the removal of the "E2E suite fails on `develop`" gap row, and a short statement of the rule this establishes: **an E2E test creates the data it needs and shares no identifier with another test.** Note the `e2e/helpers.ts` seam so the next person uses it. If the test count changed, say so and why. Update `e2e/README.md`, whose per-file counts will no longer match. Remove the E2E row from [`docs/BACKLOG.md`](../docs/BACKLOG.md), and remove the sentence in `CLAUDE.md` that says the suite fails 11 of 38 and is not a usable gate. Set this file to `**Status:** done`.

## Outcome

The suite is green and its tests are independent. **34 passed, 0 failed**, in 40s — the baseline run took 7.4 minutes because most of it was timeouts.

Independence was verified, not assumed:

| Run | Result |
|---|---|
| `--workers=1` (the CI setting) | 34/34 |
| parallel (default workers) | 34/34 |
| parallel again, **no database reset** | 34/34 |
| `--repeat-each=2` (68 tests) | 68/68 |
| `--workers=1` again, still no reset | 34/34 |

### What the causes actually turned out to be

The spec named three; there were **six**. The two extra were found only after fixing the first ones — cause A was masking them, which is exactly what a red suite does.

| # | Cause | Fix |
|---|---|---|
| A | Six module-scope `testEmail` constants re-registered per test → `400 Email already registered` → `waitForURL` timeout. 8 of the 11 baseline failures | `e2e/helpers.ts`; every test gets its own account |
| B | `public-form-flow.spec.ts` pointed at `shareId '53SGWRKS0N8E'`, which existed nowhere | `createPublishedForm(request)` seeds over the API |
| C | Three assertions on copy the app never rendered | Corrected, and moved to `data-testid` |
| D | `.pdf-viewer` is not a class — it is `pdf-viewer-container`, and CSS matches whole tokens | Corrected |
| **E** | **`button:has-text("Logout")` matched nothing.** The desktop logout is icon-only; "Logout" lives in a `v-tooltip`, which is not in the DOM, and in the mobile drawer | Added `data-testid="logout-button"` and `aria-label` to `DashboardView.vue` |
| **F** | **`waitForURL(/\/form\/confirm/)` could never match.** The route is `/form/:shareId/confirmation` | Corrected to `/\/form\/[^/]+\/confirmation/` |

### Test count: 38 → 34

Seven tests in `pdf-workflow.spec.ts` had names about upload, viewer rendering, toolbars and navigation, and bodies that all asserted the same thing — that `.dashboard-view` was visible after login. None uploaded anything; none could fail for the reason its name gave. Replaced by three that assert what they claim, including **one that genuinely uploads a PDF and waits for the viewer to render** — coverage the suite never had. Net −4 tests, +1 real behaviour.

### Product changes

Three `data-testid`s and one `aria-label`, all additive: `logout-button` (`DashboardView.vue`, also fixing a missing accessible name on an icon-only button), `public-submit-button` (`PublicFormView.vue`), `confirm-submit-button` (`SubmitPreviewModal.vue`). No behaviour changed.

`playwright.config.ts` now sets the `RATE_LIMIT_*` variables in `webServer.env`, closing the footgun [`features/0002`](0002-rate-limiting-on-public-write-paths.md) introduced: a clean checkout runs green with no local `.env` editing.

`e2e/README.md` was rewritten. Its "Best Practices" section had been *teaching* cause A — `const testEmail = \`test-${Date.now()}@example.com\`` presented as the recommended pattern — and its stated total (36) matched no reality.

Other suites: 237 frontend, **71** mocked backend, 14 database-backed, both type checks and the frontend build clean.

### One extra fix, outside this spec's scope

The final verification caught the mocked backend suite failing intermittently — the third such one-off across three features. It reproduced on the first iteration of a hunting loop as `tests/rate-limit.spec.ts > configuration > falls back to the safe default when the limit is not a usable integer`, a test written in [`features/0002`](0002-rate-limiting-on-public-write-paths.md).

Its assertion was "three login attempts were not blocked, therefore the limit fell back to 10" — which silently depends on how many hits the shared limiter is holding, state the test does not control. It now asserts the effective limit directly from the draft-8 `RateLimit-Policy` header (`q=10`), which is the thing under test and is immune to prior state. A second test was added for a valid configured limit (`q=7`).

Evidence: 3 failures in roughly 60 full-suite runs before, **0 in 50 consecutive runs after**. Causation is not proven — the failure was never reproducible on demand — but the state-dependent assertion that failed no longer exists. Fixed here rather than filed, because the standard is that a feature finishes with every suite green.
