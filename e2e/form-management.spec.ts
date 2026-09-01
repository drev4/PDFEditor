import { test, expect } from '@playwright/test';
import path from 'node:path';
import { registerNewUser, type TestUser } from './helpers';

const FIXTURE_PDF = path.join(process.cwd(), 'backend', 'test-fixtures', 'valid.pdf');

test.describe('Form Management', () => {
  let user: TestUser;

  test.beforeEach(async ({ page }) => {
    // A fresh account per test: sharing one across the block is what used to
    // make every test after the first fail on `400 Email already registered`.
    user = await registerNewUser(page, 'form');
  });

  test('should display empty state when no forms exist', async ({ page }) => {
    // /dashboard is the list of forms now, so the empty state is that list's:
    // a heading saying there is nothing yet, and the dropzone that fixes it.
    // The assertion this replaced looked for a "welcome back" hero, which the
    // design canvas does not have.
    await expect(page.locator('text=No forms yet').first()).toBeVisible();
    await expect(page.locator('text=/upload|drop a pdf/i').first()).toBeVisible();
  });

  test('should have access to upload functionality', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]').first();
    await expect(fileInput).toBeAttached();

    await expect(page.locator('text=/upload|drag.*drop/i').first()).toBeVisible();
  });

  test('should show user information in header', async ({ page }) => {
    await expect(page.locator(`text=${user.email}`)).toBeVisible();

    await expect(page.locator('[data-testid="logout-button"]')).toBeVisible();
  });

  test('should display correct page title', async ({ page }) => {
    await expect(page).toHaveTitle(/PDF|VuePDF/i);
  });
});

test.describe('Form Save and Load', () => {
  let user: TestUser;

  test.beforeEach(async ({ page }) => {
    user = await registerNewUser(page, 'saveload');
  });

  test('should maintain session across page reloads', async ({ page }) => {
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator(`text=${user.email}`)).toBeVisible();

    await page.reload();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator(`text=${user.email}`)).toBeVisible();
  });

  test('should have responsive design elements', async ({ page }) => {
    await expect(page.locator('.dashboard-view, main').first()).toBeVisible();

    await expect(page.locator('header')).toBeVisible();
  });
});

test.describe('The shell', () => {
  let user: TestUser;

  test.beforeEach(async ({ page }) => {
    user = await registerNewUser(page, 'shell');
  });

  // /dashboard used to be the PDF editor, so signing in dropped you into an
  // empty workspace rather than into your work. It is the list of forms now,
  // and the sidebar is how you reach everything else.
  test('lands on the list of forms, with the sidebar', async ({ page }) => {
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator('[data-testid="app-sidebar"]')).toBeVisible();
    await expect(page.locator('h1', { hasText: 'Forms' })).toBeVisible();
  });

  test('reaches every destination the sidebar offers', async ({ page }) => {
    // The `nav` landmark, not the whole sidebar. The sidebar also holds the plan
    // card and the account row, both of which are links, and scoping to the
    // whole thing made this test depend on whether the plan had finished
    // loading when the click happened — which passed locally and failed in CI.
    // Destinations are what this test is about, so it should look where the
    // destinations are.
    const nav = page.locator('[data-testid="app-sidebar"]').getByRole('navigation');

    await nav.getByRole('link', { name: 'Responses' }).click();
    await expect(page).toHaveURL(/\/dashboard\/responses/);

    await nav.getByRole('link', { name: 'Members' }).click();
    await expect(page).toHaveURL(/\/dashboard\/team/);
    await expect(page.locator('[data-testid="members-table"]')).toBeVisible();

    await nav.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/dashboard\/settings/);

    await nav.getByRole('link', { name: 'Forms' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  // Responses and Settings are in the navigation before they are built. They
  // must say so rather than render an empty table, which reads as "you have no
  // data" instead of "this does not exist yet".
  test('says plainly which screens are not built', async ({ page }) => {
    await page.goto('/dashboard/responses');
    await expect(page.locator('text=Not built yet')).toBeVisible();

    await page.goto('/dashboard/settings');
    // Scoped to the General tab now (features/0021): the API keys tab beside it
    // is built, so "nothing else" is a claim about this tab and not the screen.
    await expect(page.locator('text=Nothing else on this tab yet')).toBeVisible();
    // The one real thing on it.
    await expect(page.locator(`text=${user.email}`).first()).toBeVisible();
  });

  // The API keys tab (features/0021). This suite pins `DEV_PLAN_KEY: 'team'`
  // (see playwright.config.ts), so these organizations do have API access and
  // the reachable path is the one worth walking: mint a key and see the secret
  // exactly once. The refusal on a plan without the API is covered by
  // ApiKeysPanel.spec.ts, which can choose its plan.
  test('mints an API key and shows the secret once', async ({ page }) => {
    await page.goto('/dashboard/settings');

    await page.locator('[data-testid="settings-tab-api-keys"]').click();
    // The tab is in the URL, so a link can point at it and a reload keeps it.
    await expect(page).toHaveURL(/tab=api-keys/);

    await page.locator('[data-testid="api-key-name"]').fill('E2E integration');
    await page.locator('[data-testid="create-key-submit"]').click();

    // The whole credential, and the only time it is ever shown: the server
    // keeps `sha256(secret)` and cannot reproduce it.
    const secret = page.locator('[data-testid="api-key-secret"]');
    await expect(secret).toBeVisible();
    await expect(secret).toHaveValue(/^vpk_[0-9a-f]+_.+/);

    await page.locator('[data-testid="dismiss-api-key"]').click();

    // Gone for good, and the key itself still listed.
    await expect(secret).toHaveCount(0);
    await expect(page.locator('[data-testid="api-keys-table"]')).toContainText('E2E integration');
  });

  // The editor is its own route now, and its rail is part of the screen rather
  // than something that appears once a document is open.
  test('the editor is its own screen and always has its rail', async ({ page }) => {
    await page.goto('/dashboard/editor');

    await expect(page.locator('[data-testid="editor-rail"]')).toBeVisible();
    // Full-bleed: no app sidebar competing with the document.
    await expect(page.locator('[data-testid="app-sidebar"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="back-to-forms"]')).toBeVisible();
  });

  // One rail, always open. The field types used to live in a floating toolbar
  // that collapsed on mouseout, and the rail was a set of tabs.
  test('the rail offers every field type and the pages, without disclosure', async ({ page }) => {
    await page.goto('/dashboard/editor');
    const rail = page.locator('[data-testid="editor-rail"]');

    for (const type of ['text', 'textarea', 'checkbox', 'radio', 'dropdown']) {
      await expect(rail.locator(`[data-testid="add-field-${type}"]`)).toBeVisible();
    }

    await expect(rail.getByText('Fields', { exact: true })).toBeVisible();
    await expect(rail.getByText('Pages', { exact: true }).first()).toBeVisible();
  });

  // From inside a form the only way out used to be the back link: the menu
  // button opened the editor's own rail, not the application's navigation.
  test('the editor menu opens the dashboard navigation', async ({ page }) => {
    await page.goto('/dashboard/editor');

    await page.locator('[data-testid="editor-menu-button"]').click();

    const drawer = page.locator('.p-drawer');
    await expect(drawer.getByRole('link', { name: 'Members' })).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'Settings' })).toBeVisible();

    await drawer.getByRole('link', { name: 'Members' }).click();
    await expect(page).toHaveURL(/\/dashboard\/team/);
  });

  // The download button was at the bottom of a side panel, past the search box.
  test('offers the download from the editor top bar once a document is open', async ({ page }) => {
    await page.goto('/dashboard/editor');
    await expect(page.locator('[data-testid="download-pdf-button"]')).toHaveCount(0);

    await page.locator('input[type="file"]').first().setInputFiles(FIXTURE_PDF);

    await expect(page.locator('[data-testid="download-pdf-button"]')).toBeVisible({ timeout: 30000 });
  });

  // Leaving with an unsaved document offered two answers - lose it, or stay.
  // The third is the one people want, and it was a browser confirm() besides.
  test('offers to save an unsaved document on the way out', async ({ page }) => {
    await page.goto('/dashboard/editor');
    await page.locator('input[type="file"]').first().setInputFiles(FIXTURE_PDF);
    await expect(page.locator('.pdf-viewer-container')).toBeVisible({ timeout: 30000 });

    await page.locator('[data-testid="back-to-forms"]').click();

    const dialog = page.locator('[data-testid="unsaved-changes-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-testid="unsaved-save"]')).toBeVisible();
    await expect(dialog.locator('[data-testid="unsaved-discard"]')).toBeVisible();

    // Staying really stays.
    await dialog.locator('[data-testid="unsaved-cancel"]').click();
    await expect(page).toHaveURL(/\/dashboard\/editor/);

    // Saving stores the document with no fields at all, and then leaves.
    await page.locator('[data-testid="back-to-forms"]').click();
    await dialog.locator('[data-testid="unsaved-save"]').click();

    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30000 });
    await expect(page.locator('[data-testid="form-row"]')).toHaveCount(1);
  });

  // "New form" went straight to the editor, which still held whatever document
  // was last opened - so it reopened an existing form instead of starting one.
  test('New form asks for a PDF instead of reopening the last one', async ({ page }) => {
    const button = page.locator('[data-testid="new-form-button"]');
    await expect(button).toBeVisible();

    const input = page.locator('[data-testid="new-form-input"]');
    await expect(input).toBeAttached();
    await expect(input).toHaveAttribute('accept', 'application/pdf');

    // It stays on the list until a file is actually chosen.
    await button.click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});

test.describe('Navigation and Routing', () => {
  test('should redirect root to dashboard when authenticated', async ({ page }) => {
    await registerNewUser(page, 'nav');

    await page.goto('/');

    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('should redirect root to login when not authenticated', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveURL(/\/login/);
  });

  test('should navigate from register to login', async ({ page }) => {
    await page.goto('/register');

    const loginLink = page.locator('a:has-text("Sign in"), a:has-text("Login")');

    if (await loginLink.count() > 0) {
      await loginLink.first().click();
      await expect(page).toHaveURL(/\/login/);
    }
  });

  test('should navigate from login to register', async ({ page }) => {
    await page.goto('/login');

    const registerLink = page.locator('a:has-text("Sign up"), a:has-text("Register"), a:has-text("Create account")');

    if (await registerLink.count() > 0) {
      await registerLink.first().click();
      await expect(page).toHaveURL(/\/register/);
    }
  });
});
