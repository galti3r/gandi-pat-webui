// @ts-check
const { test, expect } = require('@playwright/test');

const PAT = process.env.PAT;
const DOMAIN = process.env.DOMAIN || 'galtier.top';

const TEST_TIMESTAMP = Date.now();
const TEST_PREFIX = '_e2e-bulk-' + TEST_TIMESTAMP;

const API_BASE = process.env.BASE_URL || `http://localhost:${process.env.TEST_PORT || '8001'}`;

// Helper: create a TXT record via the API directly (bypasses UI undo mechanism)
async function apiCreateRecord(name, value) {
    const resp = await fetch(`${API_BASE}/v5/livedns/domains/${DOMAIN}/records/${name}/TXT`, {
        method: 'PUT',
        headers: {
            'Authorization': 'Bearer ' + PAT,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ rrset_ttl: 10800, rrset_values: [value] })
    });
    if (!resp.ok) throw new Error(`API PUT ${name} failed: ${resp.status}`);
}

// Helper: delete a TXT record via the API directly
async function apiDeleteRecord(name) {
    await fetch(`${API_BASE}/v5/livedns/domains/${DOMAIN}/records/${name}/TXT`, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + PAT }
    });
}

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

async function navigateToHistory(page) {
    await page.click('[data-tab="history"]');
    await expect(page.locator('#content-history')).toBeVisible({ timeout: 5000 });
}

async function navigateToRecords(page) {
    await page.click('[data-tab="records"]');
    await expect(page.locator('#content-records')).toBeVisible({ timeout: 5000 });
}

test.describe('Bulk Operations → Single History Entry', () => {
    test.describe.configure({ mode: 'serial' });
    /** @type {import('@playwright/test').BrowserContext} */
    let context;
    /** @type {import('@playwright/test').Page} */
    let page;

    test.beforeAll(async ({ browser }) => {
        if (!PAT) return;
        context = await browser.newContext();
        page = await context.newPage();

        // Create test records via API before any UI interaction
        await apiCreateRecord(TEST_PREFIX + '-a', '"bulk-test-value-a"');
        await apiCreateRecord(TEST_PREFIX + '-b', '"bulk-test-value-b"');

        await loginAndSelectDomain(page);
    });

    test.afterAll(async () => {
        // Cleanup via API regardless of test outcome
        await apiDeleteRecord(TEST_PREFIX + '-a').catch(() => {});
        await apiDeleteRecord(TEST_PREFIX + '-b').catch(() => {});
        if (context) await context.close();
    });

    test('setup: clear history', async () => {
        test.skip(!PAT, 'PAT not provided in environment');
        await navigateToHistory(page);

        const clearAllBtn = page.locator('[data-action="clear-history"]');
        if (await clearAllBtn.count() > 0) {
            await clearAllBtn.click();
            const confirmBtn = page.locator('.confirm__actions .btn--danger');
            await expect(confirmBtn).toBeVisible({ timeout: 5000 });
            await confirmBtn.click();
            await expect(page.locator('#content-history .content-panel__empty')).toBeVisible({ timeout: 5000 });
        }
    });

    // ----- Core test: bulk delete → single history entry -----

    test('bulk delete should produce exactly 1 history entry', async () => {
        test.skip(!PAT, 'PAT not provided in environment');
        await navigateToRecords(page);

        // Refresh records to load API-created test records
        await page.locator('[data-action="refresh-records"]').click();
        await expect(page.locator('#content-records')).toContainText(TEST_PREFIX + '-a', { timeout: 15000 });

        // Search for our test records and wait for debounce re-render
        const searchInput = page.locator('.toolbar__search');
        await searchInput.fill(TEST_PREFIX);
        const rows = page.locator('#content-records .table tbody tr');
        await expect(rows).toHaveCount(2, { timeout: 10000 });

        // Select all visible records via checkboxes
        for (let i = 0; i < 2; i++) {
            const checkbox = rows.nth(i).locator('input[type="checkbox"]');
            if (await checkbox.count() > 0) {
                await checkbox.check();
            }
        }

        // Click bulk delete button (no data-action, identified by class + text)
        const bulkDeleteBtn = page.locator('button.btn--danger', { hasText: /Delete selected|Supprimer/ });
        await expect(bulkDeleteBtn).toBeVisible({ timeout: 3000 });
        await bulkDeleteBtn.click();

        // Confirm bulk delete
        const confirmBtn = page.locator('.confirm__actions .btn--danger');
        await expect(confirmBtn).toBeVisible({ timeout: 5000 });

        // Listen for DELETE API call BEFORE clicking confirm (fires after 5s undo)
        const deleteDone = page.waitForResponse(
            resp => resp.url().includes('/records/') && resp.request().method() === 'DELETE',
            { timeout: 20000 }
        );
        await confirmBtn.click();
        // Wait for actual API deletion (undo 5s + network)
        await deleteDone;

        // After DELETEs, executeBatchOperations fires a fire-and-forget chain:
        //   API.getText(afterZone) → History.log() → IndexedDB write
        // plus fetchRecords() in parallel.
        // Wait for the post-delete GET /records responses (afterZone + fetchRecords).
        await page.waitForResponse(
            resp => resp.url().endsWith('/records') && resp.request().method() === 'GET',
            { timeout: 15000 }
        );
        await page.waitForResponse(
            resp => resp.url().endsWith('/records') && resp.request().method() === 'GET',
            { timeout: 15000 }
        );

        // Navigate to history — History.log() IndexedDB write should be done by now.
        // If not (rare race), re-trigger render by toggling tabs.
        await navigateToHistory(page);
        const timeline = page.locator('.history-timeline');
        const emptyState = page.locator('#content-history .content-panel__empty');
        await expect(timeline.or(emptyState)).toBeVisible({ timeout: 10000 });

        if (await emptyState.isVisible()) {
            // IndexedDB write was still in progress — re-render
            await navigateToRecords(page);
            await navigateToHistory(page);
        }
        await expect(timeline).toBeVisible({ timeout: 10000 });

        const entries = page.locator('.history-entry');
        const entryCount = await entries.count();
        expect(entryCount).toBe(1);

        // The single entry should have the bulk-delete badge
        const bulkBadge = page.locator('.history-entry__badge--delete');
        await expect(bulkBadge.first()).toBeVisible();

        const badgeText = await bulkBadge.first().textContent();
        expect(
            badgeText.includes('BULK DELETE') ||
            badgeText.includes('SUPPRESSION GROUPÉE')
        ).toBeTruthy();

        // Should show the count of records
        const record = page.locator('.history-entry__record');
        await expect(record.first()).toBeVisible();

        // Should list individual affected records
        const bulkItems = page.locator('.history-entry__bulk-item');
        const itemCount = await bulkItems.count();
        expect(itemCount).toBeGreaterThanOrEqual(2);
    });
});
