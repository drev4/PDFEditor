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

  /**
   * Undo covers fields, and the key is the only way to reach it that a unit
   * test cannot prove (features/0047). Everything else about the stack is
   * asserted in `src/stores/editor.store.undo.spec.ts`; what needs a browser is
   * that `Ctrl+Z` is bound at all, and that the field really moves back.
   */
  test('takes a field drag back with Ctrl+Z', async ({ page }) => {
    await page.goto('/dashboard/editor');
    await page.locator('input[type="file"]').first().setInputFiles(FIXTURE_PDF);
    await expect(page.locator('.pdf-viewer-container')).toBeVisible({ timeout: 30000 });

    await page.locator('[data-testid="add-field-text"]').first().click();
    await page.locator('.form-fields-overlay').click({ position: { x: 160, y: 160 } });

    const field = page.locator('.form-field-item').first();
    await expect(field).toBeVisible();

    // Placing a field creates the form behind it, which saves. Let that settle
    // before measuring, or the box moves under the drag for reasons of its own.
    await page.waitForTimeout(2000);

    const before = await field.boundingBox();
    if (!before) throw new Error('the placed field has no box');

    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width / 2 + 110, before.y + before.height / 2 + 80, { steps: 8 });
    await page.mouse.up();

    // The overlay is drawn scaled, so a 110px mouse delta is a smaller delta on
    // screen. What matters is that it moved, and that the undo puts it back
    // exactly — not how far.
    const after = await field.boundingBox();
    expect(after!.x).toBeGreaterThan(before.x + 20);

    await page.keyboard.press('Control+z');

    await expect
      .poll(async () => Math.round((await field.boundingBox())!.x))
      .toBe(Math.round(before.x));
  });

  /**
   * The keyboard half of features/0048.
   *
   * The coalescing, the geometry and the store's invariants are all asserted in
   * unit tests. What only a browser can show is that the arrow keys are bound at
   * all, that a burst of them is a single `Ctrl+Z` away from being undone, and
   * that shift-clicking a second field really moves both.
   */
  test('nudges a selection with the arrow keys, and undoes the burst in one press', async ({ page }) => {
    await page.goto('/dashboard/editor');
    await page.locator('input[type="file"]').first().setInputFiles(FIXTURE_PDF);
    await expect(page.locator('.pdf-viewer-container')).toBeVisible({ timeout: 30000 });

    /**
     * Places a field at the first point of the page that nothing is covering.
     *
     * Fixed coordinates do not work here: the floating drawing toolbar and the
     * properties panel both sit over the canvas, they move with the viewport,
     * and a click that lands on either is intercepted rather than placed. The
     * overlay only takes the pointer while a field is being placed, which is
     * exactly when this runs — so a point whose topmost element *is* the overlay
     * is a point where a field can be dropped, and one whose topmost element is
     * anything else is not.
     */
    const placeFieldBelow = async (minY: number) => {
      await page.locator('[data-testid="add-field-text"]').first().click();

      const point = await page.evaluate((from) => {
        const overlay = document.querySelector('.form-fields-overlay');
        if (!overlay) return null;
        const box = overlay.getBoundingClientRect();
        for (let y = Math.max(box.top + 40, from); y < box.bottom - 40; y += 15) {
          for (let x = box.left + 60; x < box.right - 60; x += 20) {
            if (document.elementFromPoint(x, y) === overlay) return { x, y };
          }
        }
        return null;
      }, minY);

      if (!point) throw new Error(`no free point on the page below ${minY}`);
      await page.mouse.click(point.x, point.y);
      return point;
    };

    const fields = page.locator('.form-field-item');

    // Placing the first field creates the form behind it, which saves — and the
    // save puts a full-screen loading layer over the page. Placing the second
    // one before that clears finds nothing on the canvas clickable at all.
    const firstPoint = await placeFieldBelow(0);
    await expect(fields).toHaveCount(1);
    await page.waitForTimeout(2000);

    await placeFieldBelow(firstPoint.y + 90);
    await expect(fields).toHaveCount(2);
    await page.waitForTimeout(2000);

    const first = fields.nth(0);
    const second = fields.nth(1);
    const firstBefore = await first.boundingBox();
    const secondBefore = await second.boundingBox();
    if (!firstBefore || !secondBefore) throw new Error('a placed field has no box');

    // The second field is selected from placing it; shift-click adds the first.
    await first.click({ modifiers: ['Shift'] });
    await expect(page.locator('[data-testid="selection-count"]')).toContainText('2 fields');

    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');

    await expect
      .poll(async () => (await first.boundingBox())!.x)
      .toBeGreaterThan(firstBefore.x);
    expect((await second.boundingBox())!.x).toBeGreaterThan(secondBefore.x);

    // Ten presses, one burst, one entry: a single undo puts both fields back.
    await page.keyboard.press('Control+z');

    await expect
      .poll(async () => Math.round((await first.boundingBox())!.x))
      .toBe(Math.round(firstBefore.x));
    expect(Math.round((await second.boundingBox())!.x)).toBe(Math.round(secondBefore.x));
  });

  test('should offer a working upload affordance on an empty dashboard', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]').first();
    await expect(fileInput).toBeAttached();
    await expect(fileInput).toHaveAttribute('accept', 'application/pdf');

    await expect(page.locator('text=/upload|drag.*drop/i').first()).toBeVisible();
  });

  test('should show the app name and a logout control in the header', async ({ page }) => {
    await expect(page.locator('text=VuePDF Forms').first()).toBeVisible();
    await expect(page.locator('[data-testid="logout-button"]')).toBeVisible();
  });
});
