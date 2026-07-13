# E2E Tests - VuePDF Forms Platform

This folder contains the end-to-end (E2E) tests for the VuePDF Forms Platform, using Playwright.

## Test Structure

### 1. `auth-flow.spec.ts` (6 tests)
Tests for the complete authentication flow:
- New user registration
- Login with existing credentials
- Error with invalid credentials
- Logout
- Route protection without authentication
- Redirection when already authenticated

### 2. `pdf-workflow.spec.ts` (7 tests)
Tests for the PDF workflow:
- PDF upload
- Upload progress
- PDF viewing
- Editor toolbar
- Navigation between views
- Fields toolbar
- Save panel

### 3. `form-management.spec.ts` (9 tests)
Form management tests:
- Empty state on startup
- Upload functionality
- User information in header
- Correct page title
- Session persistence
- Responsive layout
- Routing redirects
- Navigation between pages

### 4. `error-handling.spec.ts` (13 tests)
Error handling and UX tests:
- Validation errors
- Email format validation
- Password validation
- Invalid credentials errors
- Network errors
- Loading states
- Keyboard navigation
- Show/hide password toggle
- Consistent branding
- Form accessibility

### 5. `example.spec.ts` (1 test)
Initial Playwright example test.

## Running the Tests

### Prerequisites
1. Backend must be running at `http://localhost:3000`
2. Frontend must be running at `http://localhost:5173`
3. PostgreSQL database must be available

### Commands

```bash
# Run all E2E tests
npm run test:e2e

# Run with visual UI (recommended for development)
npm run test:e2e:ui

# Run with the browser visible
npm run test:e2e:headed

# Run in debug mode
npm run test:e2e:debug

# Run a specific file
npx playwright test e2e/auth-flow.spec.ts

# Run a specific test
npx playwright test -g "should register a new user"
```

## Test Coverage

Total: **36 E2E tests**

### By Category:
- Authentication: 6 tests (17%)
- PDF Workflow: 7 tests (19%)
- Form Management: 9 tests (25%)
- Error Handling & UX: 13 tests (36%)
- Example: 1 test (3%)

### Areas Covered:
- Registration and login
- Route protection
- File upload
- Navigation and routing
- Form validation
- Error handling
- Loading states
- Basic accessibility
- Responsive design
- Session persistence

## Configuration

The Playwright configuration lives in [`playwright.config.ts`](../playwright.config.ts):

```typescript
{
  testDir: './e2e',
  baseURL: 'http://localhost:5173',
  webServer: {
    command: 'npm run dev --prefix frontend',
    url: 'http://localhost:5173',
  }
}
```

## Writing New Tests

### Basic Template

```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  const testEmail = `test-${Date.now()}@example.com`;

  test.beforeEach(async ({ page }) => {
    // Setup: Login, navigate, etc.
  });

  test('should do something', async ({ page }) => {
    // Arrange
    await page.goto('/some-page');

    // Act
    await page.click('button');

    // Assert
    await expect(page.locator('text=Success')).toBeVisible();
  });
});
```

### Best Practices

1. **Use semantic selectors**
   ```typescript
   // Good
   page.locator('button:has-text("Submit")')
   page.locator('input[type="email"]')

   // Avoid
   page.locator('.class-name-12345')
   ```

2. **Unique emails for each test**
   ```typescript
   const testEmail = `test-${Date.now()}@example.com`;
   ```

3. **Use beforeEach for shared setup**
   ```typescript
   test.beforeEach(async ({ page }) => {
     // Shared login
   });
   ```

4. **Verify loading states**
   ```typescript
   await expect(button).toBeDisabled();
   await expect(spinner).toBeVisible();
   ```

5. **Appropriate timeouts**
   ```typescript
   await expect(element).toBeVisible({ timeout: 5000 });
   ```

## Debugging

### View Tests in UI Mode
```bash
npm run test:e2e:ui
```
This opens a visual interface where you can:
- View all tests
- Run individual tests
- View screenshots and videos
- Inspect the DOM

### Debug Mode
```bash
npm run test:e2e:debug
```
Opens the Playwright Inspector for step-by-step debugging.

### Screenshots on Failure
Playwright automatically captures screenshots when a test fails.
They are saved in `test-results/`.

### Trace Viewer
```bash
npx playwright show-trace trace.zip
```

## Performance

### Running in Parallel
By default, Playwright runs tests in parallel:
```typescript
// playwright.config.ts
{
  fullyParallel: true,
  workers: process.env.CI ? 1 : undefined
}
```

### Retrying Failed Tests
In CI, tests are automatically retried:
```typescript
{
  retries: process.env.CI ? 2 : 0
}
```

## CI/CD

To run in CI:

```yaml
# .github/workflows/e2e.yml
- name: Install dependencies
  run: npm ci

- name: Install Playwright
  run: npx playwright install --with-deps

- name: Run E2E tests
  run: npm run test:e2e
```

## Planned Tests

Upcoming tests to add, covering the public form flow:
- [ ] Public form flow (`/form/:shareId`)
- [ ] Response submission
- [ ] Field validation in the public view
- [ ] Sharing a form
- [ ] Copy link to clipboard

## Resources

- [Playwright Docs](https://playwright.dev)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Playwright Selectors](https://playwright.dev/docs/selectors)
- [Playwright Assertions](https://playwright.dev/docs/test-assertions)

---

**Last updated:** 2026-01-29
**Total tests:** 36
**Coverage:** Full authentication, dashboard, and routing flows
