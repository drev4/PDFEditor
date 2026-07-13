import { test, expect } from '@playwright/test';

test.describe('Public Form Submission', () => {
    // Note: This test relies on a form with shareId '53SGWRKS0N8E' being present in the DB
    // and having at least one text field.
    const shareId = '53SGWRKS0N8E';

    test('should allow a public user to fill and submit a form', async ({ page }) => {
        // 1. Visit the public form URL
        console.log(`Navigating to /form/${shareId}`);
        const response = await page.goto(`/form/${shareId}`);

        // Check if the page loaded
        expect(response?.status()).toBe(200);

        // 2. Wait for the PDF viewer and fields to load
        console.log('Waiting for .pdf-viewer...');
        await page.waitForSelector('.pdf-viewer', { timeout: 15000 });

        // 3. Verify fields are present
        console.log('Waiting for .public-field-item...');
        const fields = page.locator('.public-field-item');
        await expect(fields.first()).toBeVisible({ timeout: 15000 });

        // 4. Fill the first text input found
        const textInput = page.locator('.text-input').first();
        if (await textInput.count() > 0) {
            console.log('Filling text input...');
            await textInput.fill('E2E Test Submission');
            await textInput.blur();
        }

        // 5. Submit the form
        const submitBtn = page.locator('button:has-text("Submit")');
        await expect(submitBtn).toBeVisible();
        console.log('Clicking Submit...');
        await submitBtn.click();

        // 6. Verify Preview Modal
        console.log('Waiting for preview modal...');
        await expect(page.locator('text=Preview your answers')).toBeVisible();

        // 7. Confirm Submission
        const confirmBtn = page.locator('button:has-text("Confirm Submission")');
        console.log('Confirming submission...');
        await confirmBtn.click();

        // 8. Verify Success Navigation
        console.log('Waiting for confirmation page...');
        await page.waitForURL(/\/form\/confirm/, { timeout: 15000 });
        await expect(page.locator('text=Response Submitted!')).toBeVisible();
    });

    test('should persist drafts in localStorage', async ({ page }) => {
        await page.goto(`/form/${shareId}`);
        await page.waitForSelector('.pdf-viewer');

        const textInput = page.locator('.text-input').first();
        if (await textInput.count() > 0) {
            await textInput.fill('Persistent Draft Test');
            await textInput.blur();

            // Wait a moment for debounced save
            await page.waitForTimeout(1500);

            // Reload page
            await page.reload();
            await page.waitForSelector('.pdf-viewer');

            // Check if value is still there
            await expect(page.locator('.text-input').first()).toHaveValue('Persistent Draft Test');
        }
    });
});
