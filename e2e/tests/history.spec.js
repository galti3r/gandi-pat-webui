// @ts-check
const { test, expect } = require('@playwright/test');

const PAT = process.env.PAT;
const DOMAIN = process.env.DOMAIN || 'galtier.top';

// Shared timestamp for the test record name
const TEST_TIMESTAMP = Date.now();
const TEST_RECORD_NAME = '_e2e-hist-' + TEST_TIMESTAMP;
const TEST_RECORD_VALUE = '"e2e-history-test-value"';

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
    await page.waitForTimeout(500);
    const domainItem = page.locator(`[data-domain="${DOMAIN}"]`);
    if (await domainItem.count() > 0) {
        await domainItem.click();
    }

    // Wait for records to load
    await expect(page.locator('#content-records .table, #content-records .content-panel__empty')).toBeVisible({ timeout: 15000 });
}

// Helper: navigate to the history tab
async function navigateToHistory(page) {
    await page.click('[data-tab="history"]');
    await expect(page.locator('#content-history')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(1000);
}

// Helper: navigate to the records tab
async function navigateToRecords(page) {
    await page.click('[data-tab="records"]');
    await expect(page.locator('#content-records')).toBeVisible({ timeout: 5000 });
}

// Use a shared browser context so IndexedDB persists between tests
test.describe('History Feature', () => {
    test.describe.configure({ mode: 'serial' });
    /** @type {import('@playwright/test').BrowserContext} */
    let context;
    /** @type {import('@playwright/test').Page} */
    let page;

    test.beforeAll(async ({ browser }) => {
        if (!PAT) return;
        context = await browser.newContext();
        page = await context.newPage();
        await loginAndSelectDomain(page);
    });

    test.afterAll(async () => {
        if (context) await context.close();
    });

    test('should display history tab with title', async () => {
        test.skip(!PAT, 'PAT not provided in environment');
        await navigateToHistory(page);

        const header = page.locator('#content-history .section-header__title');
        await expect(header).toBeVisible({ timeout: 5000 });
        const headerText = await header.textContent();
        expect(
            headerText === 'Change History (Local)' || headerText === 'Historique des modifications (local)'
        ).toBeTruthy();

        const description = page.locator('#content-history .section-header__description');
        await expect(description).toBeVisible();
    });

    test('should show empty state after clearing history', async () => {
        test.skip(!PAT, 'PAT not provided in environment');
        await navigateToHistory(page);

        // Clear all history
        const clearAllBtn = page.locator('[data-action="clear-history"]');
        if (await clearAllBtn.count() > 0) {
            await clearAllBtn.click();
            const confirmBtn = page.locator('.confirm__actions .btn--danger');
            await expect(confirmBtn).toBeVisible({ timeout: 5000 });
            await confirmBtn.click();
            await page.waitForTimeout(1000);
        }

        const emptyMsg = page.locator('#content-history .content-panel__empty');
        await expect(emptyMsg).toBeVisible({ timeout: 5000 });
    });

    test('should record a create operation in history', async () => {
        test.skip(!PAT, 'PAT not provided in environment');

        // Switch to records tab
        await navigateToRecords(page);

        // Create a TXT record
        await page.click('[data-action="add-record"]');
        await expect(page.locator('#modal-overlay')).toHaveClass(/modal-overlay--visible/, { timeout: 5000 });

        const txtBtn = page.locator('.type-selector__btn .type-selector__type', { hasText: 'TXT' });
        await txtBtn.click();
        await page.waitForTimeout(500);

        await page.locator('#field-name').fill(TEST_RECORD_NAME);
        await page.locator('[data-field="value"] textarea').fill(TEST_RECORD_VALUE);
        await page.locator('[data-form-action="submit"]').click();

        // Wait for modal to close + 5s pending period to expire
        await page.waitForTimeout(8000);

        // Navigate to history
        await navigateToHistory(page);

        // Should have the CREATE entry
        const createBadge = page.locator('.history-entry__badge--create');
        await expect(createBadge.first()).toBeVisible({ timeout: 10000 });

        const timeline = page.locator('.history-timeline');
        await expect(timeline).toContainText(TEST_RECORD_NAME, { timeout: 5000 });
    });

    test('should show compact diff for CREATE entry (Values only, no Before)', async () => {
        test.skip(!PAT, 'PAT not provided in environment');

        // History tab should already be open from previous test, but ensure we're there
        const historyContent = page.locator('#content-history');
        if (!await historyContent.isVisible().catch(() => false)) {
            await navigateToHistory(page);
        }

        const entries = page.locator('.history-entry');
        const entryCount = await entries.count();
        expect(entryCount).toBeGreaterThan(0);

        // Find the entry containing our test record
        let targetEntry = null;
        for (let i = 0; i < entryCount; i++) {
            const entryText = await entries.nth(i).textContent();
            if (entryText.includes(TEST_RECORD_NAME)) {
                targetEntry = entries.nth(i);
                break;
            }
        }
        expect(targetEntry).not.toBeNull();

        // CREATE should NOT have a "Before" / old diff line
        const oldValue = targetEntry.locator('.history-entry__diff-value--old');
        expect(await oldValue.count()).toBe(0);

        // CREATE should have a "Values" / new diff line containing the record value
        const newValue = targetEntry.locator('.history-entry__diff-value--new');
        await expect(newValue).toBeVisible();
        const newText = await newValue.textContent();
        expect(newText).toContain(TEST_RECORD_VALUE);

        // The label should say "Values" / "Valeurs" (not "After" / "Après")
        const diffLabel = targetEntry.locator('.history-entry__diff-label');
        await expect(diffLabel).toBeVisible();
        const labelText = await diffLabel.textContent();
        expect(
            labelText.includes('Values') || labelText.includes('Valeurs')
        ).toBeTruthy();
    });

    test('should export zone file from history entry', async () => {
        test.skip(!PAT, 'PAT not provided in environment');

        // Find the entry
        const entries = page.locator('.history-entry');
        let targetEntry = null;
        const entryCount = await entries.count();
        for (let i = 0; i < entryCount; i++) {
            const entryText = await entries.nth(i).textContent();
            if (entryText.includes(TEST_RECORD_NAME)) {
                targetEntry = entries.nth(i);
                break;
            }
        }
        expect(targetEntry).not.toBeNull();

        // Click export and wait for download
        const exportBtn = targetEntry.locator('[data-action="export"]');
        await expect(exportBtn).toBeVisible();

        const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
        await exportBtn.click();
        const download = await downloadPromise;

        // Verify file name
        const fileName = download.suggestedFilename();
        expect(fileName).toContain(DOMAIN);
        expect(fileName).toContain('-zone-');
        expect(fileName).toMatch(/\.txt$/);
    });

    test('should show rollback confirmation with diff', async () => {
        test.skip(!PAT, 'PAT not provided in environment');

        // Find the entry
        const entries = page.locator('.history-entry');
        let targetEntry = null;
        const entryCount = await entries.count();
        for (let i = 0; i < entryCount; i++) {
            const entryText = await entries.nth(i).textContent();
            if (entryText.includes(TEST_RECORD_NAME)) {
                targetEntry = entries.nth(i);
                break;
            }
        }
        expect(targetEntry).not.toBeNull();

        // Click rollback
        const rollbackBtn = targetEntry.locator('[data-action="rollback"]');
        await expect(rollbackBtn).toBeVisible();
        await rollbackBtn.click();

        // Modal should appear
        const modal = page.locator('#modal-overlay');
        await expect(modal).toHaveClass(/modal-overlay--visible/, { timeout: 5000 });

        const confirmMessage = page.locator('.confirm__message');
        await expect(confirmMessage).toBeVisible();
        const confirmText = await confirmMessage.textContent();
        expect(
            confirmText.includes('Rollback this change') ||
            confirmText.includes('Annuler cette modification')
        ).toBeTruthy();

        // Danger confirm button present
        const confirmBtn = page.locator('.confirm__actions .btn--danger');
        await expect(confirmBtn).toBeVisible();

        // Cancel without executing
        const cancelBtn = page.locator('.confirm__actions .btn:not(.btn--danger)');
        await cancelBtn.click();
        await page.waitForTimeout(500);
    });

    test('should toggle domain filter', async () => {
        test.skip(!PAT, 'PAT not provided in environment');

        // Re-render history tab to reset state
        await navigateToHistory(page);

        const domainFilter = page.locator('#history-domain-filter');
        await expect(domainFilter).toBeVisible();
        await expect(domainFilter).toBeChecked();

        const entriesBefore = await page.locator('.history-entry').count();

        // Uncheck
        await domainFilter.uncheck();
        await page.waitForTimeout(1000);
        await expect(domainFilter).not.toBeChecked();

        const entriesAfter = await page.locator('.history-entry').count();
        expect(entriesAfter).toBeGreaterThanOrEqual(entriesBefore);

        // Re-check
        await domainFilter.check();
        await page.waitForTimeout(1000);
        await expect(domainFilter).toBeChecked();
    });

    test('cleanup: delete test record', async () => {
        test.skip(!PAT, 'PAT not provided in environment');

        await navigateToRecords(page);

        const searchInput = page.locator('.toolbar__search');
        await searchInput.fill('_e2e-hist-');
        await page.waitForTimeout(500);

        const rows = page.locator('#content-records .table tbody tr');
        const rowCount = await rows.count();

        if (rowCount > 0) {
            const deleteBtn = rows.first().locator('button[title="Delete record"]');
            if (await deleteBtn.count() > 0) {
                await deleteBtn.click();

                const confirmBtn = page.locator('.confirm__actions .btn--danger');
                await expect(confirmBtn).toBeVisible({ timeout: 5000 });
                await confirmBtn.click();

                // Wait for undo period
                await page.waitForTimeout(6000);
            }
        }
    });
});
