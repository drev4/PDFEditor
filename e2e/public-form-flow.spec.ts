import { test, expect } from '@playwright/test';
import { createPublishedForm, type SeededForm } from './helpers';

// This suite used to point at a hardcoded shareId ('53SGWRKS0N8E') that existed
// on nobody's machine, so both tests failed everywhere. Each test now creates
// its own published form over the API and submits to that.
test.describe('Public Form Submission', () => {
    let form: SeededForm;

    test.beforeEach(async ({ request }) => {
        form = await createPublishedForm(request);
    });

    test('should allow a public user to fill and submit a form', async ({ page }) => {
        const response = await page.goto(`/form/${form.shareId}`);
        expect(response?.status()).toBe(200);

        // `.pdf-viewer-container` is the real class; `.pdf-viewer` never existed.
        await page.waitForSelector('.pdf-viewer-container', { timeout: 30000 });

        const fields = page.locator('.public-field-item');
        await expect(fields.first()).toBeVisible({ timeout: 30000 });

        // The respondent notice (features/0032). The form is created by the
        // fixture without asking for metadata, so the default holds and the
        // notice must **not** claim an address is recorded. A notice that
        // over-claims is as wrong as one that under-claims, and this is the
        // assertion that catches the flag being ignored end to end.
        const notice = page.locator('[data-testid="respondent-notice"]');
        await expect(notice).toBeVisible();
        await expect(notice).toContainText('sent to the organization');
        await expect(notice).not.toContainText('IP address');

        const textInput = page.locator('.text-input').first();
        await expect(textInput).toBeVisible();
        await textInput.fill('E2E Test Submission');
        await textInput.blur();

        await page.locator('[data-testid="public-submit-button"]').click();

        // The dialog is headed "Review Your Responses" and its confirm button
        // reads "Confirm and Submit" - see SubmitPreviewModal.vue.
        await expect(page.locator('text=Review Your Responses')).toBeVisible();
        await page.locator('[data-testid="confirm-submit-button"]').click();

        // The route is /form/:shareId/confirmation - the old /form/confirm never matched.
        await page.waitForURL(/\/form\/[^/]+\/confirmation/, { timeout: 30000 });
        await expect(page.locator('text=Response Submitted')).toBeVisible();
    });

    test('should persist drafts in localStorage', async ({ page }) => {
        await page.goto(`/form/${form.shareId}`);
        await page.waitForSelector('.pdf-viewer-container', { timeout: 30000 });

        const textInput = page.locator('.text-input').first();
        await expect(textInput).toBeVisible({ timeout: 30000 });
        await textInput.fill('Persistent Draft Test');
        await textInput.blur();

        // The draft save is debounced.
        await page.waitForTimeout(1500);

        await page.reload();
        await page.waitForSelector('.pdf-viewer-container', { timeout: 30000 });

        await expect(page.locator('.text-input').first()).toHaveValue('Persistent Draft Test');
    });
});
