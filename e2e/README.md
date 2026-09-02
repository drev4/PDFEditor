# E2E Tests — VuePDF Forms Platform

End-to-end tests for the VuePDF Forms Platform, using Playwright.

**The rule that keeps this suite trustworthy: a test creates the data it needs, and shares no identifier with any other test.** No fixed email, no fixed `shareId`, no dependence on a clean database or on what ran before. See [`docs/sot/09-quality-and-testing.md`](../docs/sot/09-quality-and-testing.md) and [`features/0003`](../features/0003-e2e-suite-green-and-independent.md) for why — the suite was red for months because tests shared a registration email.

## Helpers — use these, do not inline setup

Everything shared lives in [`helpers.ts`](./helpers.ts):

| Helper | What it does |
|---|---|
| `registerNewUser(page, prefix?)` | Registers a fresh account through the UI, lands on `/dashboard`, returns the user |
| `loginUser(page, user)` | Logs an existing user in through the UI |
| `createPublishedForm(request, fieldLabel?)` | Seeds a published form with one text field over the HTTP API, returns its `shareId` and `fieldId` |
| `newUser(prefix?)` / `uniqueEmail(prefix?)` | A unique identity: `Date.now()` **plus** a uuid fragment |

`createPublishedForm` uses Playwright's `request` fixture against the real API rather than Prisma, so the routes are actually exercised — a database seed would skip them.

## Test structure

| File | Tests | Covers |
|---|---|---|
| `auth-flow.spec.ts` | 6 | Registration, login, logout, route protection, redirect when authenticated |
| `error-handling.spec.ts` | 12 | Validation errors, invalid credentials, network errors, loading states, keyboard nav, branding, accessibility |
| `form-management.spec.ts` | 10 | Empty state, upload affordance, header, page title, session persistence, responsive layout, routing |
| `pdf-workflow.spec.ts` | 3 | **Real PDF upload → viewer render**, upload affordance, header controls |
| `public-form-flow.spec.ts` | 2 | Public submission end to end, draft persistence in `localStorage` |
| `example.spec.ts` | 1 | Page title smoke test |

**Total: 34 tests.**

## Running

Playwright starts both apps itself (`webServer` in [`playwright.config.ts`](../playwright.config.ts)). You need PostgreSQL up — `docker compose up -d` — and nothing else. Rate limits are raised for the suite in `webServer.env`, so no local `.env` editing is required.

```bash
npm run test:e2e                    # parallel, the normal run
npm run test:e2e -- --workers=1     # the CI setting
npm run test:e2e:ui                 # visual UI, best for development
npm run test:e2e:headed             # watch the browser
npm run test:e2e:debug              # Playwright Inspector

npx playwright test e2e/auth-flow.spec.ts       # one file
npx playwright test -g "should register"        # one test
```

### Verifying independence, not just green

A green run is not enough — these are what catch a test that depends on another:

```bash
npm run test:e2e -- --workers=1     # serial
npm run test:e2e                    # parallel
npm run test:e2e                    # again, WITHOUT resetting the database
npm run test:e2e -- --repeat-each=2 # order and state sensitivity
```

## Writing new tests

```typescript
import { test, expect } from '@playwright/test';
import { registerNewUser } from './helpers';

test.describe('Feature Name', () => {
  test('should do something', async ({ page }) => {
    // Its own account. Never a shared one.
    const user = await registerNewUser(page, 'feature');

    await page.click('[data-testid="some-button"]');

    await expect(page.locator('[data-testid="result"]')).toBeVisible();
  });
});
```

### Best practices

1. **Never share an identifier between tests.** Not an email, not a `shareId`, not a form id.

   ```typescript
   // Good — a fresh account, inside the test
   const user = await registerNewUser(page);

   // Wrong — evaluated once per module, reused by every test in the block.
   // The second registration returns 400 and the app never leaves /register.
   const testEmail = `test-${Date.now()}@example.com`;
   ```

   `Date.now()` on its own is not unique either: parallel workers import a module in the same millisecond.

2. **Prefer `data-testid` over visible copy.** Copy changes; a test that breaks on wording is a test people learn to ignore. If a control has no testid, add one to the component in the same change.

   ```typescript
   // Good
   page.locator('[data-testid="logout-button"]')

   // Fragile — and this one silently matched nothing, because the desktop
   // logout button is icon-only and "Logout" lives in a tooltip.
   page.locator('button:has-text("Logout")')
   ```

3. **Check a class actually exists before selecting on it.** A CSS selector matches whole class tokens: `.pdf-viewer` does **not** match `class="pdf-viewer-container"`, even though grep suggests it does.

4. **A test must be able to fail for the reason its name gives.** If it is named for PDF upload, it has to upload a PDF. A test that asserts something unrelated reports coverage that does not exist, which is worse than no test.

5. **Appropriate timeouts.** Real uploads and PDF.js rendering are slow; give them room (`{ timeout: 30000 }`) rather than making the whole suite patient.

## Debugging

- **UI mode:** `npm run test:e2e:ui` — run individual tests, inspect the DOM, view screenshots and video.
- **Inspector:** `npm run test:e2e:debug` — step through.
- **Screenshots** on failure are written to `test-results/`.
- **Traces:** `npx playwright show-trace trace.zip` (captured on first retry).

## CI

The `e2e-tests` job in [`.github/workflows/test.yml`](../.github/workflows/test.yml) runs a `postgres:16` service, applies migrations with `prisma migrate deploy`, installs Chromium, and runs the suite with `workers: 1` and `retries: 2`.

## Resources

- [Playwright Docs](https://playwright.dev)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Playwright Selectors](https://playwright.dev/docs/selectors)
- [Playwright Assertions](https://playwright.dev/docs/test-assertions)
