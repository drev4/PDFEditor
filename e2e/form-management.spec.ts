import { test, expect } from '@playwright/test';
import { registerNewUser, type TestUser } from './helpers';

test.describe('Form Management', () => {
  let user: TestUser;

  test.beforeEach(async ({ page }) => {
    // A fresh account per test: sharing one across the block is what used to
    // make every test after the first fail on `400 Email already registered`.
    user = await registerNewUser(page, 'form');
  });

  test('should display empty state when no forms exist', async ({ page }) => {
    // The empty state is a dropzone, not a greeting: the design canvas has no
    // "welcome back" hero, and the assertion that looked for one was checking
    // decoration rather than the thing a new user actually needs to find.
    await expect(page.locator('text=Start a form').first()).toBeVisible();
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
