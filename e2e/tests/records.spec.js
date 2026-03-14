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

    // Wait for domains to load
    await expect(page.locator('#domain-count')).not.toHaveText('', { timeout: 10000 });

    // Select the test domain
    await page.click('#domain-search-input');
    const domainItem = page.locator(`[data-domain="${DOMAIN}"]`);
    await expect(domainItem).toBeVisible({ timeout: 5000 });
    await domainItem.click();

    // Wait for records to load
    await expect(page.locator('#content-records .table, #content-records .content-panel__empty')).toBeVisible({ timeout: 15000 });
}

test.describe('DNS Records', () => {
    test.beforeEach(async ({ page }) => {
        test.skip(!PAT, 'PAT not provided in environment');
        await loginAndSelectDomain(page);
    });

    test('should display records table after selecting domain', async ({ page }) => {
        // Records table should be visible
        const table = page.locator('#content-records .table');
        await expect(table).toBeVisible({ timeout: 15000 });

        // Should have table headers (index 0 is the bulk-select checkbox column)
        const headers = table.locator('th');
        await expect(headers.nth(1)).toContainText('Name');
        await expect(headers.nth(2)).toContainText('Type');
        await expect(headers.nth(3)).toContainText('TTL');
        await expect(headers.nth(4)).toContainText('Values');
    });

    test('should have toolbar with search and type filter', async ({ page }) => {
        // Search input should exist
        const searchInput = page.locator('.toolbar__search');
        await expect(searchInput).toBeVisible();

        // Type filter select should exist
        const typeFilter = page.locator('.toolbar__filter');
        await expect(typeFilter).toBeVisible();

        // Add record button should exist
        const addBtn = page.locator('[data-action="add-record"]');
        await expect(addBtn).toBeVisible();
    });

    test('should filter records by search text', async ({ page }) => {
        const searchInput = page.locator('.toolbar__search');
        await searchInput.fill('@');

        // Table should still be visible after filtering (@ matches apex records)
        const table = page.locator('#content-records .table');
        await expect(table).toBeVisible();
    });

    test('should filter records by type', async ({ page }) => {
        const typeFilter = page.locator('.toolbar__filter');

        // Pick the first available type option (options are dynamic, <option> is not "visible")
        const firstOption = typeFilter.locator('option:not([value=""])').first();
        await firstOption.waitFor({ state: 'attached', timeout: 5000 });
        const selectedType = await firstOption.getAttribute('value');

        await typeFilter.selectOption(selectedType);

        // All visible type badges should match the selected type
        const typeCells = page.locator('#content-records .table tbody .tag');
        const count = await typeCells.count();
        if (count > 0) {
            for (let i = 0; i < count; i++) {
                await expect(typeCells.nth(i)).toHaveText(selectedType);
            }
        }
    });

    test('should open add record modal', async ({ page }) => {
        await page.click('[data-action="add-record"]');

        // Modal should appear
        const modal = page.locator('#modal-overlay');
        await expect(modal).toHaveClass(/modal-overlay--visible/, { timeout: 5000 });

        // Modal title should indicate new record
        const title = page.locator('[data-modal="title"]');
        await expect(title).toContainText('Add DNS Record');
    });

    test('should create a TXT test record', async ({ page }) => {
        const testName = '_e2e-test-' + Date.now();
        const testValue = '"e2e-playwright-test-value"';

        // Open add record form
        await page.click('[data-action="add-record"]');
        await expect(page.locator('#modal-overlay')).toHaveClass(/modal-overlay--visible/, { timeout: 5000 });

        // Click TXT type button in the type selector
        const txtBtn = page.locator('.type-selector__btn .type-selector__type', { hasText: 'TXT' });
        await txtBtn.click();

        // Wait for form fields to render after type selection
        const nameInput = page.locator('#field-name');
        await expect(nameInput).toBeVisible({ timeout: 5000 });

        // Fill in the name
        await nameInput.fill(testName);

        // Fill in the value (TXT uses a textarea inside [data-field="value"])
        const valueInput = page.locator('[data-field="value"] textarea');
        await valueInput.fill(testValue);

        // Listen for API PUT before submit (undo fires after 5s)
        const apiDone = page.waitForResponse(
            resp => resp.url().includes('/records/') && resp.request().method() === 'PUT',
            { timeout: 20000 }
        );

        // Submit the form
        const submitBtn = page.locator('[data-form-action="submit"]');
        await submitBtn.click();

        // Wait for modal to close + actual API call to complete
        await expect(page.locator('#modal-overlay')).not.toHaveClass(/modal-overlay--visible/, { timeout: 5000 });
        await apiDone;
    });

    test('should delete the TXT test record', async ({ page }) => {
        // Search for e2e test records
        const searchInput = page.locator('.toolbar__search');
        await searchInput.fill('_e2e-test-');

        // Wait for filtered rows to appear
        const firstRow = page.locator('#content-records .table tbody tr').first();
        await expect(firstRow).toBeVisible({ timeout: 5000 });

        // Find and click delete button on the first matching record
        const deleteBtn = firstRow.locator('button[title="Delete record"]');

        if (await deleteBtn.count() > 0) {
            await deleteBtn.click();

            // Confirm deletion
            const confirmBtn = page.locator('.confirm__actions .btn--danger');
            await expect(confirmBtn).toBeVisible({ timeout: 5000 });

            // Listen for API DELETE (fires after 5s undo period)
            const apiDone = page.waitForResponse(
                resp => resp.url().includes('/records/') && resp.request().method() === 'DELETE',
                { timeout: 20000 }
            );
            await confirmBtn.click();
            await apiDone;
        }
    });
});
