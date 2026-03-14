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

// ===============================================================
// Bug 3 — Page size selector
// ===============================================================
test.describe('Bug 3: Page size selector', () => {
    test.beforeEach(async ({ page }) => {
        test.skip(!PAT, 'PAT not provided in environment');
        await loginAndSelectDomain(page);
    });

    test('pagination should show page size selector', async ({ page }) => {
        const pageSizeSelect = page.locator('.pagination__page-size');
        await expect(pageSizeSelect).toBeVisible({ timeout: 5000 });

        // Should have expected options
        const options = pageSizeSelect.locator('option');
        const count = await options.count();
        expect(count).toBe(5); // 10, 25, 50, 100, All
    });

    test('changing page size to 10 should show at most 10 rows', async ({ page }) => {
        const pageSizeSelect = page.locator('.pagination__page-size');
        await expect(pageSizeSelect).toBeVisible({ timeout: 5000 });

        await pageSizeSelect.selectOption('10');
        await page.waitForTimeout(300);

        const rows = page.locator('#content-records .table tbody tr');
        const rowCount = await rows.count();
        expect(rowCount).toBeLessThanOrEqual(10);
        expect(rowCount).toBeGreaterThan(0);
    });

    test('changing page size to All should keep "0" selected after re-render', async ({ page }) => {
        const pageSizeSelect = page.locator('.pagination__page-size');
        await expect(pageSizeSelect).toBeVisible({ timeout: 5000 });

        // Select All (value=0)
        await pageSizeSelect.selectOption('0');
        await page.waitForTimeout(500);

        // After re-render, the select should still show "0" (not reverted to 25)
        await expect(pageSizeSelect).toHaveValue('0');
    });

    test('page-size selector chevron should not overlap number text', async ({ page }) => {
        const pageSizeSelect = page.locator('.pagination__page-size');
        await expect(pageSizeSelect).toBeVisible({ timeout: 5000 });

        // padding-right must be >= 1.5rem (24px) to leave room for the chevron
        const paddingRight = await pageSizeSelect.evaluate(el =>
            parseFloat(window.getComputedStyle(el).paddingRight)
        );
        expect(paddingRight).toBeGreaterThanOrEqual(24);
    });

    test('"All" (0) should persist after tab switch — not revert to 25', async ({ page }) => {
        const pageSizeSelect = page.locator('.pagination__page-size');
        await expect(pageSizeSelect).toBeVisible({ timeout: 5000 });

        // Select All
        await pageSizeSelect.selectOption('0');
        await page.waitForTimeout(500);
        await expect(pageSizeSelect).toHaveValue('0');

        // Switch to another tab and back
        await page.click('[data-tab="dnssec"]');
        await expect(page.locator('#content-dnssec')).toBeVisible({ timeout: 5000 });
        await page.click('[data-tab="records"]');
        await expect(page.locator('#content-records .table')).toBeVisible({ timeout: 15000 });

        // Page-size selector should still show "All" (0), not reverted to 25
        const pageSizeAfter = page.locator('.pagination__page-size');
        await expect(pageSizeAfter).toHaveValue('0');
    });
});

// ===============================================================
// Bug 4 — Search focus retention
// ===============================================================
test.describe('Bug 4: Search focus retention', () => {
    test.beforeEach(async ({ page }) => {
        test.skip(!PAT, 'PAT not provided in environment');
        await loginAndSelectDomain(page);
    });

    test('search input should retain focus after typing', async ({ page }) => {
        const searchInput = page.locator('.toolbar__search');
        await searchInput.click();
        await searchInput.type('test', { delay: 50 });

        // Wait for debounce + re-render
        await page.waitForTimeout(500);

        // Verify focus is still on search input
        const isFocused = await page.locator('.toolbar__search').evaluate(
            el => el === document.activeElement
        );
        expect(isFocused).toBe(true);

        // Verify value is preserved
        const value = await page.locator('.toolbar__search').inputValue();
        expect(value).toBe('test');
    });
});

// ===============================================================
// Bug 5 — No-op update detection
// ===============================================================
test.describe('Bug 5: No-op update detection', () => {
    test.beforeEach(async ({ page }) => {
        test.skip(!PAT, 'PAT not provided in environment');
        await loginAndSelectDomain(page);
    });

    test('submitting edit without changes should show info toast', async ({ page }) => {
        // Click the first edit button
        const editBtn = page.locator('.table__td--actions .btn--icon').first();
        await editBtn.click();

        // Wait for modal
        const modal = page.locator('.modal');
        await expect(modal).toBeVisible({ timeout: 5000 });

        // Submit button must be visible
        const submitBtn = page.locator('[data-form-action="submit"]');
        await expect(submitBtn).toBeVisible({ timeout: 3000 });
        await submitBtn.click();

        // Should show info toast (no changes detected)
        const toast = page.locator('.toast--info');
        await expect(toast).toBeVisible({ timeout: 3000 });

        // Modal should still be open
        await expect(modal).toBeVisible();
    });
});

// ===============================================================
// Bug 6 — Rollback dialog size
// ===============================================================
test.describe('Bug 6: Rollback dialog large', () => {
    test.beforeEach(async ({ page }) => {
        test.skip(!PAT, 'PAT not provided in environment');
        await loginAndSelectDomain(page);
    });

    test('history tab should be accessible', async ({ page }) => {
        // Navigate to History tab
        const historyTab = page.locator('[data-tab="history"]');
        await historyTab.click();
        await page.waitForTimeout(500);

        const historyContent = page.locator('#content-history');
        await expect(historyContent).toBeVisible({ timeout: 5000 });
    });

    test('rollback dialog with zone data should use modal--large', async ({ page }) => {
        // Navigate to History tab
        const historyTab = page.locator('[data-tab="history"]');
        await historyTab.click();
        await page.waitForTimeout(500);

        // Look for a rollback button (only present if history has entries)
        const rollbackBtn = page.locator('[data-action="rollback"]').first();
        const hasEntries = await rollbackBtn.count() > 0;

        if (hasEntries) {
            await rollbackBtn.click();

            const modal = page.locator('.modal');
            await expect(modal).toBeVisible({ timeout: 5000 });

            // If this entry has zone data, the modal should have modal--large
            // If it's a simple record op, it won't — both are valid states
            const hasLargeClass = await modal.evaluate(el => el.classList.contains('modal--large'));
            const hasZoneDiff = await page.locator('.zone-diff-split').count() > 0;

            // If zone diff is shown, modal must be large
            if (hasZoneDiff) {
                expect(hasLargeClass).toBe(true);
            }

            // Close the dialog
            await page.locator('.modal__close, [data-action="modal-close"]').first().click();
        }
    });
});

// ===============================================================
// Bug 7 — Modal does not close when resizing (mousedown tracking)
// ===============================================================
test.describe('Bug 7: Modal resize mousedown tracking', () => {
    test.beforeEach(async ({ page }) => {
        test.skip(!PAT, 'PAT not provided in environment');
        await loginAndSelectDomain(page);
    });

    test('mousedown inside modal + mouseup on overlay should NOT close modal', async ({ page }) => {
        // Open zone editor (resizable modal)
        const editBtn = page.locator('[data-action="edit-zone-text"]');
        await expect(editBtn).toBeVisible({ timeout: 5000 });
        await editBtn.click();

        const modal = page.locator('.modal');
        await expect(modal).toBeVisible({ timeout: 5000 });

        const overlay = page.locator('#modal-overlay');

        // Get modal bounding box — mousedown inside, mouseup on overlay
        const modalBox = await modal.boundingBox();
        const overlayBox = await overlay.boundingBox();

        // mousedown on the modal edge (inside)
        await page.mouse.move(modalBox.x + modalBox.width - 5, modalBox.y + modalBox.height / 2);
        await page.mouse.down();

        // drag to overlay (outside)
        await page.mouse.move(overlayBox.x + 10, overlayBox.y + 10);
        await page.mouse.up();

        // Modal should still be visible (not closed by the overlay click)
        await expect(modal).toBeVisible();
    });

    test('click directly on overlay should still close modal', async ({ page }) => {
        // Open zone editor
        const editBtn = page.locator('[data-action="edit-zone-text"]');
        await expect(editBtn).toBeVisible({ timeout: 5000 });
        await editBtn.click();

        const modal = page.locator('.modal');
        await expect(modal).toBeVisible({ timeout: 5000 });

        const overlay = page.locator('#modal-overlay');
        const overlayBox = await overlay.boundingBox();

        // Click directly on overlay (not on the modal)
        // Use top-left corner which should be outside the centered modal
        await page.mouse.click(overlayBox.x + 5, overlayBox.y + 5);
        await page.waitForTimeout(300);

        // Modal should be closed
        await expect(overlay).not.toHaveClass(/modal-overlay--visible/);
    });
});

// ===============================================================
// Bug 8 — Sticky toolbar + domain bar z-index
// ===============================================================
test.describe('Bug 8: Sticky toolbar', () => {
    test.beforeEach(async ({ page }) => {
        test.skip(!PAT, 'PAT not provided in environment');
        await loginAndSelectDomain(page);
    });

    test('toolbar should have position: sticky', async ({ page }) => {
        const toolbar = page.locator('.toolbar');
        await expect(toolbar).toBeVisible({ timeout: 5000 });

        // Check declared style (necessary but not sufficient —
        // contain:layout on an ancestor can silently break sticky)
        const position = await toolbar.evaluate(el =>
            window.getComputedStyle(el).position
        );
        expect(position).toBe('sticky');

        // Check that no ancestor between toolbar and its scroll container
        // has container-type or contain:layout that would break sticky
        const hasLayoutContainment = await toolbar.evaluate(el => {
            let parent = el.parentElement;
            const scrollContainer = document.getElementById('content');
            while (parent && parent !== scrollContainer) {
                const style = window.getComputedStyle(parent);
                if (style.containerType && style.containerType !== 'normal') {
                    return true;
                }
                if (style.contain && style.contain.includes('layout')) {
                    return true;
                }
                parent = parent.parentElement;
            }
            return false;
        });
        expect(hasLayoutContainment).toBe(false);
    });

    test('toolbar should have background-color to cover content when scrolling', async ({ page }) => {
        const toolbar = page.locator('.toolbar');
        await expect(toolbar).toBeVisible({ timeout: 5000 });

        const bgColor = await toolbar.evaluate(el =>
            window.getComputedStyle(el).backgroundColor
        );
        expect(bgColor).not.toBe('transparent');
        expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');
    });

    test('toolbar should remain visible after scrolling down', async ({ page }) => {
        // Select "All" to ensure enough rows to scroll
        const pageSizeSelect = page.locator('.pagination__page-size');
        if (await pageSizeSelect.count() > 0) {
            await pageSizeSelect.selectOption('0');
            await page.waitForTimeout(500);
        }

        const content = page.locator('#content');
        const toolbar = page.locator('.toolbar');

        // Inject a spacer inside the active content panel to guarantee
        // enough scroll distance, regardless of how many records exist.
        await content.evaluate(el => {
            const panel = el.querySelector('.content-panel--active') || el;
            const spacer = document.createElement('div');
            spacer.style.height = '3000px';
            spacer.dataset.testSpacer = 'true';
            panel.appendChild(spacer);
        });

        // Scroll content area to the bottom and verify in one atomic call
        // (avoids event handlers resetting scrollTop between set and get)
        const scrollTop = await content.evaluate(el => {
            el.scrollTop = el.scrollHeight;
            return el.scrollTop;
        });
        expect(scrollTop).toBeGreaterThan(0);

        await page.waitForTimeout(200);

        // Toolbar should still be in the viewport (sticky at top of scroll area)
        await expect(toolbar).toBeVisible();
        const toolbarRect = await toolbar.evaluate(el => {
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom };
        });
        expect(toolbarRect.top).toBeGreaterThanOrEqual(0);
        expect(toolbarRect.bottom).toBeLessThanOrEqual(
            await page.evaluate(() => window.innerHeight)
        );
    });

    test('domain bar should be visible and properly sized', async ({ page }) => {
        const domainBar = page.locator('#domain-bar');
        await expect(domainBar).toBeVisible({ timeout: 5000 });

        const height = await domainBar.evaluate(el =>
            el.getBoundingClientRect().height
        );
        expect(height).toBeGreaterThanOrEqual(40);
    });

    test('domain dropdown should appear above content area', async ({ page }) => {
        // Click elsewhere to defocus, wait for blur timer, then click input
        await page.locator('#content').click();
        await page.waitForTimeout(500);
        await page.locator('#domain-search-input').click();
        await page.waitForTimeout(500);

        const dropdownList = page.locator('.dropdown__list');
        await expect(dropdownList).toBeVisible({ timeout: 3000 });

        // The first domain item should be clickable (not hidden behind content)
        const firstItem = dropdownList.locator('.dropdown__item').first();
        await expect(firstItem).toBeVisible();

        // Verify domain item is not covered by content elements
        const isClickable = await firstItem.evaluate(el => {
            const rect = el.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const topEl = document.elementFromPoint(centerX, centerY);
            return el === topEl || el.contains(topEl);
        });
        expect(isClickable).toBe(true);

        // Close dropdown
        await page.keyboard.press('Escape');
    });
});

// ===============================================================
// Bug 9 — Pending row visual indicator (silent commit)
// ===============================================================
test.describe('Bug 9: Pending operation row class', () => {
    test.describe.configure({ mode: 'serial' });
    /** @type {import('@playwright/test').BrowserContext} */
    let context;
    /** @type {import('@playwright/test').Page} */
    let page;

    const TEST_TS = Date.now();
    const TEST_NAME = '_e2e-pending-' + TEST_TS;

    test.beforeAll(async ({ browser }) => {
        if (!PAT) return;
        context = await browser.newContext();
        page = await context.newPage();
        await loginAndSelectDomain(page);
    });

    test.afterAll(async () => {
        if (context) await context.close();
    });

    test('creating a record should show pending row with border indicator', async () => {
        test.skip(!PAT, 'PAT not provided in environment');

        // Create a TXT record
        await page.click('[data-action="add-record"]');
        await expect(page.locator('#modal-overlay')).toHaveClass(/modal-overlay--visible/, { timeout: 5000 });

        const txtBtn = page.locator('.type-selector__btn .type-selector__type', { hasText: 'TXT' });
        await txtBtn.click();
        await page.waitForTimeout(500);

        await page.locator('#field-name').fill(TEST_NAME);
        await page.locator('[data-field="value"] textarea').fill('"e2e-pending-test"');
        await page.locator('[data-form-action="submit"]').click();

        // Wait for modal to close and table to re-render
        await page.waitForTimeout(1000);

        // The newly created record should have the pending class
        const pendingRow = page.locator('.table__row--pending');
        await expect(pendingRow).toBeVisible({ timeout: 3000 });

        // Pending row should have a visible border-left
        const borderLeft = await pendingRow.first().evaluate(el =>
            window.getComputedStyle(el).borderLeftWidth
        );
        expect(parseFloat(borderLeft)).toBeGreaterThanOrEqual(3);
    });

    test('after undo timer expires, no loading overlay should appear (silent commit)', async () => {
        test.skip(!PAT, 'PAT not provided in environment');

        // Wait for the 5s undo + API call to complete
        // During this time, monitor for loading overlay
        const loadingOverlay = page.locator('#content-records .loading-overlay');

        // Wait for the pending operation to execute (5s timer + API)
        await page.waitForResponse(
            resp => resp.url().includes('/records/') && resp.request().method() === 'PUT',
            { timeout: 15000 }
        );

        // After the API call, the loading overlay should NOT appear
        // (silent commit uses renderRecords() not fetchRecords())
        await page.waitForTimeout(500);
        expect(await loadingOverlay.count()).toBe(0);

        // The pending class should be gone after re-render
        const pendingRows = page.locator('.table__row--pending');
        await page.waitForTimeout(500);
        expect(await pendingRows.count()).toBe(0);
    });

    test('cleanup: delete test record via API', async () => {
        test.skip(!PAT, 'PAT not provided in environment');

        // Wait for any pending operations to flush
        await page.waitForTimeout(2000);

        // Search and delete
        const searchInput = page.locator('.toolbar__search');
        await searchInput.fill(TEST_NAME);
        await page.waitForTimeout(500);

        const rows = page.locator('#content-records .table tbody tr');
        if (await rows.count() > 0) {
            // Find delete button by its title attribute (works in both EN/FR)
            const deleteBtn = rows.first().locator('button').filter({
                has: page.locator('[title]')
            }).last();
            if (await deleteBtn.count() > 0) {
                await deleteBtn.click();

                const confirmBtn = page.locator('.confirm__actions .btn--danger');
                if (await confirmBtn.count() > 0) {
                    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
                    await confirmBtn.click();
                    await page.waitForTimeout(6000);
                }
            }
        }
    });
});
