import { test, expect } from '@playwright/test';
import { registerNewUser } from './helpers';

/**
 * The session model from features/0008.
 *
 * These are the claims no unit test can make, because they are about what a real
 * browser does with an httpOnly cookie and an in-memory token across page loads.
 *
 * `playwright.config.ts` sets `JWT_ACCESS_TTL` to 3 seconds for the whole run,
 * so every test in this suite — not just these — exercises the refresh-and-retry
 * path rather than living entirely inside one token's lifetime.
 */
test.describe('Session', () => {
  test('refreshes an expired access token without interrupting the user', async ({ page }) => {
    const refreshes: number[] = [];
    page.on('response', r => {
      if (r.url().includes('/auth/refresh')) refreshes.push(r.status());
    });

    await registerNewUser(page, 'session');

    // Past JWT_ACCESS_TTL: the token held in memory is now dead.
    await page.waitForTimeout(3500);

    // An action that actually calls the API. Loading a PDF is not one — this app
    // opens the file locally and uploads later — so listing forms is used here.
    await page.goto('/dashboard/forms');
    await page.waitForLoadState('networkidle');

    // Still signed in. A short access token has to be invisible to the user, not
    // a logout every time one expires.
    expect(page.url()).toContain('/dashboard/forms');
    expect(refreshes).toContain(200);
  });

  test('recovers the session on a cold reload', async ({ page }) => {
    await registerNewUser(page, 'reload');

    // A reload destroys the access token, which lives only in memory. Only the
    // httpOnly refresh cookie survives, and it has to be enough.
    await page.reload();
    await page.waitForLoadState('networkidle');

    expect(page.url()).toContain('/dashboard');
    await expect(page.locator('[data-testid="logout-button"]')).toBeVisible();
  });

  test('keeps the refresh token out of reach of JavaScript', async ({ page }) => {
    await registerNewUser(page, 'httponly');

    const reachable = await page.evaluate(() => ({
      cookie: document.cookie,
      storage: JSON.stringify(localStorage)
    }));

    // Finding S4. An XSS on this origin must not be able to walk away with a
    // long-lived credential. What localStorage still holds is the user object,
    // a rendering hint that authorises nothing.
    expect(reachable.cookie).not.toContain('refresh_token');
    expect(reachable.storage).not.toContain('refresh_token');
    expect(reachable.storage).not.toContain('token"');
  });

  test('logout revokes server-side, so a captured cookie is worthless', async ({ page, context }) => {
    await registerNewUser(page, 'revoke');
    const captured = (await context.cookies()).find(c => c.name === 'refresh_token');
    expect(captured).toBeTruthy();

    await page.click('[data-testid="logout-button"]');
    await page.waitForURL(/\/login/);

    // Put the captured cookie back and try to spend it. Before this feature the
    // equivalent — a token copied out of localStorage — stayed valid for the
    // rest of its seven days, because logout was a client-side delete.
    await context.addCookies([captured!]);
    const replayed = await page.request.post('http://localhost:3000/api/auth/refresh', {
      headers: { Origin: 'http://localhost:5173' }
    });

    expect(replayed.status()).toBe(401);
  });
});
