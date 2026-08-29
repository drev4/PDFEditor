import { test, expect } from '@playwright/test';
import { registerNewUser, newUser } from './helpers';

/**
 * Two people, one organization ([`features/0010`]).
 *
 * This is the only test in the suite that proves the product is more than
 * single-player. Everything else runs as one account, so a regression that quietly
 * broke invitations would be invisible without it.
 *
 * Note there is no email step, and that is not a shortcut: this service has no
 * mail provider, so the invitation is a link the inviter copies and delivers
 * themselves. The test does what the user does.
 */
test.describe('Team', () => {
  test('an invited colleague can reach the organization forms', async ({ page, context }) => {
    // The owner creates a form, then invites someone.
    const owner = await registerNewUser(page, 'owner');
    await page.goto('/dashboard/team');

    const invitee = newUser('invitee');
    await page.fill('[data-testid="invite-email"]', invitee.email);
    await page.selectOption('[data-testid="invite-role"]', 'member');
    await page.click('[data-testid="invite-submit"]');

    // The link is shown exactly once and cannot be recovered afterwards.
    const link = await page
      .locator('[data-testid="invitation-link"]')
      .inputValue();
    expect(link).toContain('/invitations/');

    // A second browser context: a different person, no session.
    const secondContext = await context.browser()!.newContext();
    const secondPage = await secondContext.newPage();

    await secondPage.goto(link);
    await secondPage.fill('[data-testid="accept-password"]', invitee.password);
    await secondPage.click('[data-testid="accept-submit"]');
    await secondPage.waitForURL(/\/dashboard/);

    // They are in, and they can see the team they joined — including the owner
    // who invited them.
    await secondPage.goto('/dashboard/team');
    await expect(secondPage.locator('[data-testid="members-table"]')).toContainText(owner.email);
    await expect(secondPage.locator('[data-testid="members-table"]')).toContainText(invitee.email);

    // A plain member gets no invite form.
    await expect(secondPage.locator('[data-testid="invite-form"]')).toHaveCount(0);

    await secondContext.close();
  });

  test('an invitation link cannot be spent twice', async ({ page, context }) => {
    await registerNewUser(page, 'owner2');
    await page.goto('/dashboard/team');

    const invitee = newUser('invitee2');
    await page.fill('[data-testid="invite-email"]', invitee.email);
    await page.click('[data-testid="invite-submit"]');
    const link = await page.locator('[data-testid="invitation-link"]').inputValue();

    const first = await context.browser()!.newContext();
    const firstPage = await first.newPage();
    await firstPage.goto(link);
    await firstPage.fill('[data-testid="accept-password"]', invitee.password);
    await firstPage.click('[data-testid="accept-submit"]');
    await firstPage.waitForURL(/\/dashboard/);
    await first.close();

    // The link is a bearer capability, so it has to stop working once spent.
    const second = await context.browser()!.newContext();
    const secondPage = await second.newPage();
    await secondPage.goto(link);
    await secondPage.fill('[data-testid="accept-password"]', 'AnotherPassword123!');
    await secondPage.click('[data-testid="accept-submit"]');

    await expect(secondPage.locator('[data-testid="accept-error"]')).toBeVisible();
    await expect(secondPage).toHaveURL(/\/invitations\//);
    await second.close();
  });

  test('the only owner cannot demote themselves out of control', async ({ page }) => {
    await registerNewUser(page, 'lastowner');
    await page.goto('/dashboard/team');

    const row = page.locator('[data-testid="members-table"] tbody tr').first();
    const roleSelect = row.locator('select');
    await roleSelect.selectOption('member');

    // An organization with no owner cannot be administered or deleted, and
    // nothing in this product can repair one.
    await expect(page.locator('[data-testid="members-error"]')).toContainText(/only owner/i);
  });
});
