// @ts-check
const { test, expect } = require('@playwright/test');

const PAT = process.env.PAT;
const DOMAIN = process.env.DOMAIN || 'galtier.top';

async function loginAndSelectDomain(page) {
    await page.goto('/');
    await page.fill('#auth-token-input', PAT);
    await page.click('[data-action="connect"]');
    await expect(page.locator('#app-section')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#domain-count')).not.toHaveText('', { timeout: 10000 });
    await page.click('#domain-search-input');
    await page.waitForTimeout(500);
    const domainItem = page.locator(`[data-domain="${DOMAIN}"]`);
    if (await domainItem.count() > 0) {
        await domainItem.click();
    }
    await page.waitForTimeout(1000);
}

async function navigateToNameservers(page) {
    await page.click('[data-tab="nameservers"]');
    await expect(page.locator('#content-nameservers')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(2000);
}

test.describe('Nameservers Tab', () => {
    test.beforeEach(async ({ page }) => {
        test.skip(!PAT, 'PAT not provided in environment');
        await loginAndSelectDomain(page);
    });

    test('should navigate to nameservers tab', async ({ page }) => {
        await page.click('[data-tab="nameservers"]');

        const panel = page.locator('#content-nameservers');
        await expect(panel).toBeVisible({ timeout: 5000 });
    });

    test('should display nameserver list', async ({ page }) => {
        await navigateToNameservers(page);

        const panel = page.locator('#content-nameservers');

        // Should show nameservers table
        const table = panel.locator('.table');
        await expect(table).toBeVisible({ timeout: 10000 });

        // Should have at least one nameserver row
        const rows = table.locator('tbody tr');
        expect(await rows.count()).toBeGreaterThan(0);

        // Nameserver should contain "gandi" (Gandi's default NS)
        const firstNs = rows.first().locator('code');
        await expect(firstNs).toContainText('gandi');
    });

    test('should have click-to-copy on nameserver FQDN', async ({ page }) => {
        await navigateToNameservers(page);

        const panel = page.locator('#content-nameservers');

        // FQDN code elements should have the copyable class
        const copyableFqdn = panel.locator('.table tbody code.record-values--copyable');
        expect(await copyableFqdn.count()).toBeGreaterThan(0);

        // Should have a cursor pointer style (via CSS class)
        const firstFqdn = copyableFqdn.first();
        await expect(firstFqdn).toBeVisible();

        // No separate copy button column should exist
        const actionCells = panel.locator('.table tbody .table__td--actions');
        expect(await actionCells.count()).toBe(0);
    });

    test('should show registrar-level note', async ({ page }) => {
        await navigateToNameservers(page);

        const note = page.locator('#content-nameservers .info-note');
        await expect(note).toBeVisible();
    });

    test('should show Edit Nameservers button', async ({ page }) => {
        await navigateToNameservers(page);

        const editBtn = page.locator('#content-nameservers button.btn--primary');
        await expect(editBtn).toBeVisible();
    });

    test('should open edit modal with warning and pre-filled inputs', async ({ page }) => {
        await navigateToNameservers(page);

        // Click Edit button
        const editBtn = page.locator('#content-nameservers button.btn--primary');
        await editBtn.click();

        // Modal should appear
        const modal = page.locator('#modal-overlay');
        await expect(modal).toHaveClass(/modal-overlay--visible/, { timeout: 5000 });

        // Title should contain domain name
        const title = page.locator('[data-modal="title"]');
        await expect(title).toContainText(DOMAIN);

        // Warning box should be visible
        const warning = modal.locator('.form__warning');
        await expect(warning).toBeVisible();

        // Should have pre-filled NS inputs (at least 2)
        const nsInputs = modal.locator('.ns-edit__row input[type="text"]');
        expect(await nsInputs.count()).toBeGreaterThanOrEqual(2);

        // First input should have a value (pre-filled from current NS)
        const firstValue = await nsInputs.first().inputValue();
        expect(firstValue.length).toBeGreaterThan(0);
        expect(firstValue).toContain('gandi');

        // Save button should be danger-styled
        const saveBtn = modal.locator('.btn--danger');
        await expect(saveBtn).toBeVisible();

        // Close modal
        await page.keyboard.press('Escape');
    });

    test('should validate nameserver FQDN in edit modal', async ({ page }) => {
        await navigateToNameservers(page);

        // Open edit modal
        const editBtn = page.locator('#content-nameservers button.btn--primary');
        await editBtn.click();

        const modal = page.locator('#modal-overlay');
        await expect(modal).toHaveClass(/modal-overlay--visible/, { timeout: 5000 });

        // Add a new NS row with invalid FQDN
        const addBtn = modal.locator('button', { hasText: /Add nameserver|Ajouter/ });
        await addBtn.click();

        // Get all inputs and fill the last one with invalid value
        const nsInputs = modal.locator('.ns-edit__row input[type="text"]');
        const lastInput = nsInputs.last();
        await lastInput.fill('not a valid hostname!!!');

        // Click Save
        const saveBtn = modal.locator('.btn--danger');
        await saveBtn.click();

        // Error message should be visible
        const errorEl = modal.locator('.form__error[role="alert"]');
        await expect(errorEl).not.toBeEmpty({ timeout: 3000 });

        // Close modal
        await page.keyboard.press('Escape');
    });

    test('should show discard confirmation when closing with unsaved changes', async ({ page }) => {
        await navigateToNameservers(page);

        // Open edit modal
        const editBtn = page.locator('#content-nameservers button.btn--primary');
        await editBtn.click();

        const modal = page.locator('#modal-overlay');
        await expect(modal).toHaveClass(/modal-overlay--visible/, { timeout: 5000 });

        // Add a new row to make a change
        const addBtn = modal.locator('button', { hasText: /Add nameserver|Ajouter/ });
        await addBtn.click();

        const nsInputs = modal.locator('.ns-edit__row input[type="text"]');
        const lastInput = nsInputs.last();
        await lastInput.fill('ns-new.example.com.');

        // Try to close via Escape
        await page.keyboard.press('Escape');

        // Discard confirmation bar should appear
        const confirmBar = modal.locator('.record-form__confirm');
        await expect(confirmBar).toBeVisible({ timeout: 3000 });

        // Click Discard to force-close
        const discardBtn = confirmBar.locator('.btn--danger');
        await discardBtn.click();

        // Modal should be closed
        await expect(modal).not.toHaveClass(/modal-overlay--visible/, { timeout: 5000 });
    });

    test('should enforce minimum 2 nameservers', async ({ page }) => {
        await navigateToNameservers(page);

        // Open edit modal
        const editBtn = page.locator('#content-nameservers button.btn--primary');
        await editBtn.click();

        const modal = page.locator('#modal-overlay');
        await expect(modal).toHaveClass(/modal-overlay--visible/, { timeout: 5000 });

        // Get remove buttons — they should be disabled if only 2 NS rows
        const nsInputs = modal.locator('.ns-edit__row input[type="text"]');
        const inputCount = await nsInputs.count();

        // Remove extra rows until only 2 remain (if more exist)
        if (inputCount > 2) {
            const removeBtns = modal.locator('.ns-edit__row .record-form__remove-value');
            // Remove from last to get to 2
            for (let i = inputCount - 1; i >= 2; i--) {
                const btn = removeBtns.nth(i - 1);
                if (await btn.isEnabled()) {
                    await btn.click();
                }
            }
        }

        // Now with 2 rows, remove buttons should be disabled
        const removeBtns = modal.locator('.ns-edit__row .record-form__remove-value');
        const btnCount = await removeBtns.count();
        for (let i = 0; i < btnCount; i++) {
            await expect(removeBtns.nth(i)).toBeDisabled();
        }

        // Close modal
        await page.keyboard.press('Escape');
    });

    test('should reject duplicate nameservers', async ({ page }) => {
        await navigateToNameservers(page);

        // Open edit modal
        const editBtn = page.locator('#content-nameservers button.btn--primary');
        await editBtn.click();

        const modal = page.locator('#modal-overlay');
        await expect(modal).toHaveClass(/modal-overlay--visible/, { timeout: 5000 });

        // Get first NS value
        const nsInputs = modal.locator('.ns-edit__row input[type="text"]');
        const firstValue = await nsInputs.first().inputValue();

        // Add a new row with the same value (duplicate)
        const addBtn = modal.locator('button', { hasText: /Add nameserver|Ajouter/ });
        await addBtn.click();

        const lastInput = modal.locator('.ns-edit__row input[type="text"]').last();
        await lastInput.fill(firstValue);

        // Click Save
        const saveBtn = modal.locator('.btn--danger');
        await saveBtn.click();

        // Should show duplicate error
        const errorEl = modal.locator('.form__error[role="alert"]');
        await expect(errorEl).not.toBeEmpty({ timeout: 3000 });

        // Close modal
        await page.keyboard.press('Escape');
    });
});
