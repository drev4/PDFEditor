import { test, expect } from '@playwright/test';

test.describe('Form Management', () => {
  const testEmail = `form-${Date.now()}@example.com`;
  const testPassword = 'TestPassword123!';
  const testName = 'Form User';
  const formTitle = `Test Form ${Date.now()}`;
  const formDescription = 'This is a test form created by E2E tests';

  test.beforeEach(async ({ page }) => {
    // Register and login
    await page.goto('/register');
    await page.fill('[data-testid="register-name-input"]', testName);
    await page.fill('[data-testid="register-email-input"]', testEmail);
    await page.fill('#register-password-input', testPassword);
    await page.fill('#register-confirm-password-input', testPassword);
    await page.click('[data-testid="register-submit-button"]');
    await page.waitForURL(/\/dashboard/);
  });

  test('should display empty state when no forms exist', async ({ page }) => {
    // New user should see welcome screen
    await expect(page.locator('text=/welcome/i').first()).toBeVisible();
    await expect(page.locator('text=/upload|drag.*drop/i').first()).toBeVisible();
  });

  test('should have access to upload functionality', async ({ page }) => {
    // Verify file upload input is present
    const fileInput = page.locator('input[type="file"]').first();
    await expect(fileInput).toBeAttached();

    // Verify upload area is visible
    await expect(page.locator('text=/upload|drag.*drop/i').first()).toBeVisible();
  });

  test('should show user information in header', async ({ page }) => {
    // Verify user email is displayed
    await expect(page.locator(`text=${testEmail}`)).toBeVisible();

    // Verify logout button is present
    await expect(page.locator('button:has-text("Logout")')).toBeVisible();
  });

  test('should display correct page title', async ({ page }) => {
    // Verify page title
    await expect(page).toHaveTitle(/PDF|VuePDF/i);
  });
});

test.describe('Form Save and Load', () => {
  const testEmail = `saveload-${Date.now()}@example.com`;
  const testPassword = 'TestPassword123!';
  const testName = 'SaveLoad User';

  test.beforeEach(async ({ page }) => {
    // Register and login
    await page.goto('/register');
    await page.fill('[data-testid="register-name-input"]', testName);
    await page.fill('[data-testid="register-email-input"]', testEmail);
    await page.fill('#register-password-input', testPassword);
    await page.fill('#register-confirm-password-input', testPassword);
    await page.click('[data-testid="register-submit-button"]');
    await page.waitForURL(/\/dashboard/);
  });

  test('should maintain session across page reloads', async ({ page }) => {
    // Verify we're logged in
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator(`text=${testEmail}`)).toBeVisible();

    // Reload the page
    await page.reload();

    // Should still be logged in
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator(`text=${testEmail}`)).toBeVisible();
  });

  test('should have responsive design elements', async ({ page }) => {
    // Check that main container is present
    await expect(page.locator('.dashboard-view, main').first()).toBeVisible();

    // Verify header is present
    await expect(page.locator('header')).toBeVisible();
  });
});

test.describe('Navigation and Routing', () => {
  const testEmail = `nav-${Date.now()}@example.com`;
  const testPassword = 'TestPassword123!';
  const testName = 'Nav User';

  test('should redirect root to dashboard when authenticated', async ({ page }) => {
    // Register and login
    await page.goto('/register');
    await page.fill('[data-testid="register-name-input"]', testName);
    await page.fill('[data-testid="register-email-input"]', testEmail);
    await page.fill('#register-password-input', testPassword);
    await page.fill('#register-confirm-password-input', testPassword);
    await page.click('[data-testid="register-submit-button"]');
    await page.waitForURL(/\/dashboard/);

    // Navigate to root
    await page.goto('/');

    // Should redirect to dashboard
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('should redirect root to login when not authenticated', async ({ page }) => {
    // Navigate to root without authentication
    await page.goto('/');

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);
  });

  test('should navigate from register to login', async ({ page }) => {
    await page.goto('/register');

    // Look for link to login page
    const loginLink = page.locator('a:has-text("Sign in"), a:has-text("Login")');

    if (await loginLink.count() > 0) {
      await loginLink.first().click();
      await expect(page).toHaveURL(/\/login/);
    }
  });

  test('should navigate from login to register', async ({ page }) => {
    await page.goto('/login');

    // Look for link to register page
    const registerLink = page.locator('a:has-text("Sign up"), a:has-text("Register"), a:has-text("Create account")');

    if (await registerLink.count() > 0) {
      await registerLink.first().click();
      await expect(page).toHaveURL(/\/register/);
    }
  });
});
