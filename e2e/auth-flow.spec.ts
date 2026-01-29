import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  const testEmail = `test-${Date.now()}@example.com`;
  const testPassword = 'TestPassword123!';
  const testName = 'Test User';

  test('should register a new user successfully', async ({ page }) => {
    // Navigate to register page
    await page.goto('/register');

    // Wait for the register form to be visible
    await expect(page.locator('h2:has-text("Create Account")')).toBeVisible();

    // Fill in registration form
    await page.fill('[data-testid="register-name-input"]', testName);
    await page.fill('[data-testid="register-email-input"]', testEmail);
    await page.fill('#register-password-input', testPassword);
    await page.fill('#register-confirm-password-input', testPassword);

    // Submit the form
    await page.click('[data-testid="register-submit-button"]');

    // Should redirect to dashboard after successful registration
    await expect(page).toHaveURL(/\/dashboard/);

    // Verify user info is shown in header
    await expect(page.locator('text=' + testEmail)).toBeVisible();
  });

  test('should login with existing credentials', async ({ page }) => {
    // First register a user
    await page.goto('/register');
    await page.fill('[data-testid="register-name-input"]', testName);
    await page.fill('[data-testid="register-email-input"]', testEmail);
    await page.fill('#register-password-input', testPassword);
    await page.fill('#register-confirm-password-input', testPassword);
    await page.click('[data-testid="register-submit-button"]');
    await page.waitForURL(/\/dashboard/);

    // Logout
    await page.click('button:has-text("Logout")');
    await page.waitForURL(/\/login/);

    // Now login
    await page.fill('[data-testid="login-email-input"]', testEmail);
    await page.fill('#login-password-input', testPassword);
    await page.click('[data-testid="login-submit-button"]');

    // Should redirect to dashboard
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator('text=' + testEmail)).toBeVisible();
  });

  test('should show error with invalid credentials', async ({ page }) => {
    await page.goto('/login');

    // Try to login with invalid credentials
    await page.fill('[data-testid="login-email-input"]', 'invalid@example.com');
    await page.fill('#login-password-input', 'WrongPassword123');
    await page.click('[data-testid="login-submit-button"]');

    // Should show error message
    await expect(page.locator('.p-message-error, [role="alert"]')).toBeVisible();
  });

  test('should logout successfully', async ({ page }) => {
    // Login first
    await page.goto('/register');
    await page.fill('[data-testid="register-name-input"]', testName);
    await page.fill('[data-testid="register-email-input"]', testEmail);
    await page.fill('#register-password-input', testPassword);
    await page.fill('#register-confirm-password-input', testPassword);
    await page.click('[data-testid="register-submit-button"]');
    await page.waitForURL(/\/dashboard/);

    // Logout
    await page.click('button:has-text("Logout")');

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);
  });

  test('should protect dashboard route when not authenticated', async ({ page }) => {
    // Try to access dashboard without login
    await page.goto('/dashboard');

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);
  });

  test('should redirect to dashboard when accessing login while authenticated', async ({ page }) => {
    // Login first
    await page.goto('/register');
    await page.fill('[data-testid="register-name-input"]', testName);
    await page.fill('[data-testid="register-email-input"]', testEmail);
    await page.fill('#register-password-input', testPassword);
    await page.fill('#register-confirm-password-input', testPassword);
    await page.click('[data-testid="register-submit-button"]');
    await page.waitForURL(/\/dashboard/);

    // Try to access login page while authenticated
    await page.goto('/login');

    // Should redirect back to dashboard
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
