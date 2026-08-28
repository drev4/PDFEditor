import { test, expect } from '@playwright/test';
import path from 'node:path';
import { registerNewUser } from './helpers';

// This file previously held seven tests whose names described PDF upload,
// viewer rendering, toolbars and navigation, and whose bodies all asserted the
// same thing: that `.dashboard-view` was visible after logging in. None of them
// uploaded anything, so none could fail for the reason its name gave. They have
// been replaced by tests that assert what they claim — including one that
// genuinely uploads a PDF, which is coverage the suite did not have before.

const FIXTURE_PDF = path.join(process.cwd(), 'backend', 'test-fixtures', 'valid.pdf');

test.describe('PDF Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await registerNewUser(page, 'workflow');
  });

  test('should render the PDF viewer after uploading a PDF', async ({ page }) => {
    // The dashboard starts on the welcome screen, with no viewer.
    await expect(page.locator('.pdf-viewer-container')).toHaveCount(0);

    await page.locator('input[type="file"]').first().setInputFiles(FIXTURE_PDF);

    // Upload is a real round trip through POST /api/upload, then the document
    // is rendered by PDF.js, so this is deliberately patient.
    await expect(page.locator('.pdf-viewer-container')).toBeVisible({ timeout: 30000 });
  });

  test('should offer a working upload affordance on an empty dashboard', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]').first();
    await expect(fileInput).toBeAttached();
    await expect(fileInput).toHaveAttribute('accept', 'application/pdf');

    await expect(page.locator('text=/upload|drag.*drop/i').first()).toBeVisible();
  });

  test('should show the app name and a logout control in the header', async ({ page }) => {
    await expect(page.locator('text=PDF Editor Pro').first()).toBeVisible();
    await expect(page.locator('[data-testid="logout-button"]')).toBeVisible();
  });
});
