import { test, expect } from '@playwright/test';
import { registerNewUser, loginUser, newUser } from './helpers';

test.describe('Authentication Flow', () => {
  test('should register a new user successfully', async ({ page }) => {
    const user = newUser('auth');

    await page.goto('/register');
    await expect(page.locator('h2:has-text("Create Account")')).toBeVisible();

    await page.fill('[data-testid="register-name-input"]', user.name);
    await page.fill('[data-testid="register-email-input"]', user.email);
    await page.fill('#register-password-input', user.password);
    await page.fill('#register-confirm-password-input', user.password);
    await page.click('[data-testid="register-submit-button"]');

    // Should redirect to dashboard after successful registration
    await expect(page).toHaveURL(/\/dashboard/);

    // Verify user info is shown in header
    await expect(page.locator(`text=${user.email}`)).toBeVisible();
  });

  test('should login with existing credentials', async ({ page }) => {
    const user = await registerNewUser(page, 'auth');

    await page.click('[data-testid="logout-button"]');
    await page.waitForURL(/\/login/);

    await loginUser(page, user);

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator(`text=${user.email}`)).toBeVisible();
  });

  test('should show error with invalid credentials', async ({ page }) => {
    await page.goto('/login');

    await page.fill('[data-testid="login-email-input"]', 'invalid@example.com');
    await page.fill('#login-password-input', 'WrongPassword123');
    await page.click('[data-testid="login-submit-button"]');

    await expect(page.locator('.p-message-error, [role="alert"]')).toBeVisible();
  });

  test('should logout successfully', async ({ page }) => {
    await registerNewUser(page, 'auth');

    await page.click('[data-testid="logout-button"]');

    await expect(page).toHaveURL(/\/login/);
  });

  test('should protect dashboard route when not authenticated', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(page).toHaveURL(/\/login/);
  });

  test('should redirect to dashboard when accessing login while authenticated', async ({ page }) => {
    await registerNewUser(page, 'auth');

    await page.goto('/login');

    await expect(page).toHaveURL(/\/dashboard/);
  });
});
