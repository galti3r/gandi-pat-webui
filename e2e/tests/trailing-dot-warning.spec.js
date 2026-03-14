// @ts-check
const { test, expect } = require('@playwright/test');

const PAT = process.env.PAT;
const DOMAIN = process.env.DOMAIN || 'galtier.top';

// Helper: authenticate and select domain
async function loginAndSelectDomain(page) {
    await page.goto('/');
    await page.fill('#auth-token-input', PAT);
    await page.click('[data-action="connect"]');
    await expect(page.locator('#app-section')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#domain-count')).not.toHaveText('', { timeout: 10000 });
    await page.click('#domain-search-input');
    const domainItem = page.locator(`[data-domain="${DOMAIN}"]`);
    await expect(domainItem).toBeVisible({ timeout: 5000 });
    await domainItem.click();
    await expect(page.locator('#content-records .table, #content-records .content-panel__empty')).toBeVisible({ timeout: 15000 });
}

test.describe('Trailing dot warning — no layout shift', () => {
    test.beforeEach(async ({ page }) => {
        test.skip(!PAT, 'PAT not provided in environment');
        await loginAndSelectDomain(page);
    });

    test('CNAME warning should not resize the modal', async ({ page }) => {
        // Open add record modal
        await page.click('[data-action="add-record"]');
        await expect(page.locator('#modal-overlay')).toHaveClass(/modal-overlay--visible/, { timeout: 5000 });

        // Select CNAME type
        const cnameBtn = page.locator('.type-selector__btn .type-selector__type', { hasText: 'CNAME' });
        await cnameBtn.click();

        // Wait for the value field to render
        const valueField = page.locator('[data-field="value"] input');
        await expect(valueField).toBeVisible({ timeout: 5000 });

        // Measure the modal dimensions before typing
        const modal = page.locator('.modal');
        const beforeBox = await modal.boundingBox();
        expect(beforeBox).not.toBeNull();

        // Type a hostname without trailing dot to trigger the warning
        await valueField.fill('mail.example.com');

        // Wait for debounced warning to appear (300ms debounce + buffer)
        const warningEl = page.locator('[data-field="value"] .form__field-warning');
        await expect(warningEl).toHaveClass(/form__field-warning--active/, { timeout: 2000 });

        // Measure the modal dimensions after warning appeared
        const afterBox = await modal.boundingBox();
        expect(afterBox).not.toBeNull();

        // Modal must not have resized (1px tolerance for sub-pixel rounding)
        expect(Math.abs(afterBox.width - beforeBox.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(afterBox.height - beforeBox.height)).toBeLessThanOrEqual(1);
    });

    test('MX target warning should not resize the modal', async ({ page }) => {
        // Open add record modal
        await page.click('[data-action="add-record"]');
        await expect(page.locator('#modal-overlay')).toHaveClass(/modal-overlay--visible/, { timeout: 5000 });

        // Select MX type
        const mxBtn = page.locator('.type-selector__btn .type-selector__type', { hasText: 'MX' });
        await mxBtn.click();

        // Wait for the target field to render
        const targetField = page.locator('[data-field="target"] input');
        await expect(targetField).toBeVisible({ timeout: 5000 });

        // Measure modal before
        const modal = page.locator('.modal');
        const beforeBox = await modal.boundingBox();
        expect(beforeBox).not.toBeNull();

        // Type a hostname without trailing dot
        await targetField.fill('mail.example.com');

        // Wait for warning
        const warningEl = page.locator('[data-field="target"] .form__field-warning');
        await expect(warningEl).toHaveClass(/form__field-warning--active/, { timeout: 2000 });

        // Modal must not have resized
        const afterBox = await modal.boundingBox();
        expect(afterBox).not.toBeNull();
        expect(Math.abs(afterBox.width - beforeBox.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(afterBox.height - beforeBox.height)).toBeLessThanOrEqual(1);
    });

    test('warning should disappear when trailing dot is added', async ({ page }) => {
        // Open add record modal
        await page.click('[data-action="add-record"]');
        await expect(page.locator('#modal-overlay')).toHaveClass(/modal-overlay--visible/, { timeout: 5000 });

        // Select CNAME type
        const cnameBtn = page.locator('.type-selector__btn .type-selector__type', { hasText: 'CNAME' });
        await cnameBtn.click();

        const valueField = page.locator('[data-field="value"] input');
        await expect(valueField).toBeVisible({ timeout: 5000 });

        // Type without trailing dot — warning should appear
        await valueField.fill('mail.example.com');
        const warningEl = page.locator('[data-field="value"] .form__field-warning');
        await expect(warningEl).toHaveClass(/form__field-warning--active/, { timeout: 2000 });

        // Add trailing dot — warning should disappear
        await valueField.fill('mail.example.com.');

        // Wait for debounce + verify warning is gone
        await expect(warningEl).not.toHaveClass(/form__field-warning--active/, { timeout: 2000 });
    });

    test('warning should appear reactively while typing', async ({ page }) => {
        // Open add record modal
        await page.click('[data-action="add-record"]');
        await expect(page.locator('#modal-overlay')).toHaveClass(/modal-overlay--visible/, { timeout: 5000 });

        // Select CNAME type
        const cnameBtn = page.locator('.type-selector__btn .type-selector__type', { hasText: 'CNAME' });
        await cnameBtn.click();

        const valueField = page.locator('[data-field="value"] input');
        await expect(valueField).toBeVisible({ timeout: 5000 });
        const warningEl = page.locator('[data-field="value"] .form__field-warning');

        // Type partial hostname without dot — no warning yet
        await valueField.fill('example');
        await page.waitForTimeout(500);
        await expect(warningEl).not.toHaveClass(/form__field-warning--active/);

        // Continue typing with a dot — warning appears (debounced)
        await valueField.fill('example.com');
        await expect(warningEl).toHaveClass(/form__field-warning--active/, { timeout: 2000 });
    });
});
