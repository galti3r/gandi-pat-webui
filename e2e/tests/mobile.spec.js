// @ts-check
const { test, expect, devices } = require('@playwright/test');

const PAT = process.env.PAT;
const DOMAIN = process.env.DOMAIN || 'galtier.top';

// Mobile viewport configuration (iPhone 12 equivalent)
const MOBILE_VIEWPORT = { width: 390, height: 844 };

// Helper: authenticate and select a domain on mobile
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
// Meta Tags & PWA — No auth needed
// ===============================================================
test.describe('Mobile: Meta Tags & PWA', () => {
    test.use({ viewport: MOBILE_VIEWPORT });

    test('should have viewport meta tag', async ({ page }) => {
        await page.goto('/');
        const meta = page.locator('meta[name="viewport"]');
        await expect(meta).toHaveAttribute('content', 'width=device-width, initial-scale=1.0');
    });

    test('should have PWA manifest link', async ({ page }) => {
        await page.goto('/');
        const link = page.locator('link[rel="manifest"]');
        await expect(link).toHaveAttribute('href', 'manifest.json');
    });

    test('should have apple-mobile-web-app meta tags', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('meta[name="apple-mobile-web-app-capable"]'))
            .toHaveAttribute('content', 'yes');
        await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]'))
            .toHaveAttribute('content', 'default');
        await expect(page.locator('meta[name="apple-mobile-web-app-title"]'))
            .toHaveAttribute('content', 'DNS Manager');
    });

    test('should have theme-color meta tag', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('meta[name="theme-color"]'))
            .toHaveAttribute('content', '#0086c3');
    });

    test('should have manifest-src in CSP', async ({ page }) => {
        await page.goto('/');
        const csp = page.locator('meta[http-equiv="Content-Security-Policy"]');
        const content = await csp.getAttribute('content');
        expect(content).toContain('manifest-src');
    });

    test('manifest.json should be valid JSON with required fields', async ({ page }) => {
        const response = await page.goto('/manifest.json');
        expect(response.status()).toBe(200);
        const manifest = await response.json();
        expect(manifest.name).toBe('Gandi DNS Manager');
        expect(manifest.short_name).toBeTruthy();
        expect(manifest.display).toBe('standalone');
        expect(manifest.start_url).toBe('/');
        expect(manifest.icons).toBeDefined();
        expect(manifest.icons.length).toBeGreaterThan(0);
    });
});

// ===============================================================
// Auth Screen — Mobile input attributes
// ===============================================================
test.describe('Mobile: Auth Screen', () => {
    test.use({ viewport: MOBILE_VIEWPORT });

    test('auth token input should have mobile-friendly attributes', async ({ page }) => {
        await page.goto('/');
        const input = page.locator('#auth-token-input');
        await expect(input).toHaveAttribute('autocapitalize', 'none');
        await expect(input).toHaveAttribute('autocorrect', 'off');
        await expect(input).toHaveAttribute('spellcheck', 'false');
        await expect(input).toHaveAttribute('autocomplete', 'off');
    });

    test('auth section should be visible and centered on mobile', async ({ page }) => {
        await page.goto('/');
        const section = page.locator('#auth-section');
        await expect(section).toBeVisible();

        const box = await section.boundingBox();
        expect(box.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);
    });

    test('connect button should be full-width on mobile', async ({ page }) => {
        await page.goto('/');
        const btn = page.locator('#auth-connect-btn');
        await expect(btn).toBeVisible();

        const btnBox = await btn.boundingBox();
        // Full-width button should take most of the card width
        expect(btnBox.width).toBeGreaterThan(200);
    });
});

// ===============================================================
// Mobile Layout — Requires auth
// ===============================================================
test.describe('Mobile: Layout & Navigation', () => {
    test.use({ viewport: MOBILE_VIEWPORT });

    test.beforeEach(async ({ page }) => {
        test.skip(!PAT, 'PAT not provided in environment');
        await loginAndSelectDomain(page);
    });

    test('domain search input should have mobile-friendly attributes', async ({ page }) => {
        const input = page.locator('#domain-search-input');
        await expect(input).toHaveAttribute('autocapitalize', 'none');
        await expect(input).toHaveAttribute('autocorrect', 'off');
        await expect(input).toHaveAttribute('spellcheck', 'false');
    });

    test('sidebar should render as horizontal tab bar on mobile', async ({ page }) => {
        const sidebar = page.locator('#sidebar');
        await expect(sidebar).toBeVisible();

        const box = await sidebar.boundingBox();
        // On mobile, sidebar should span full width
        expect(box.width).toBeGreaterThanOrEqual(MOBILE_VIEWPORT.width - 20);
        // On mobile, sidebar should be horizontal (short height)
        expect(box.height).toBeLessThan(100);
    });

    test('nav labels should be visible on mobile (not hidden)', async ({ page }) => {
        const label = page.locator('.nav__label').first();
        await expect(label).toBeVisible();
    });

    test('tab switching should work on mobile', async ({ page }) => {
        await page.click('[data-tab="dnssec"]');
        await expect(page.locator('[data-panel="dnssec"]')).toHaveClass(/content-panel--active/);

        await page.click('[data-tab="settings"]');
        await expect(page.locator('[data-panel="settings"]')).toHaveClass(/content-panel--active/);

        await page.click('[data-tab="records"]');
        await expect(page.locator('[data-panel="records"]')).toHaveClass(/content-panel--active/);
    });

    test('content area should not overflow horizontally', async ({ page }) => {
        // Verify the page itself has no horizontal scroll (the real user-facing check)
        const pageOverflow = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
        }));
        expect(pageOverflow.scrollWidth).toBeLessThanOrEqual(pageOverflow.innerWidth);

        // Verify #content clips any internal overflow
        const content = page.locator('#content');
        const overflowX = await content.evaluate(el =>
            window.getComputedStyle(el).overflowX
        );
        expect(overflowX).toBe('hidden');
    });
});

// ===============================================================
// Mobile: Touch Targets & Accessibility
// ===============================================================
test.describe('Mobile: Touch Targets', () => {
    test.use({ viewport: MOBILE_VIEWPORT });

    test.beforeEach(async ({ page }) => {
        test.skip(!PAT, 'PAT not provided in environment');
        await loginAndSelectDomain(page);
    });

    test('icon buttons should meet 44px touch target minimum', async ({ page }) => {
        // Exclude table row action buttons (compact 36px in card layout)
        const iconButtons = page.locator('.btn--icon:not(.table__td--actions .btn--icon)');
        const count = await iconButtons.count();
        expect(count).toBeGreaterThan(0);

        for (let i = 0; i < Math.min(count, 5); i++) {
            const btn = iconButtons.nth(i);
            if (await btn.isVisible()) {
                const box = await btn.boundingBox();
                expect(box.width).toBeGreaterThanOrEqual(44);
                expect(box.height).toBeGreaterThanOrEqual(44);
            }
        }
    });

    test('form inputs should have font-size >= 16px to prevent iOS zoom', async ({ page }) => {
        // Navigate to settings which has form elements
        await page.click('[data-tab="settings"]');
        await expect(page.locator('[data-panel="settings"]')).toHaveClass(/content-panel--active/);

        const inputs = page.locator('.form__input, .form__select, .form__textarea');
        const count = await inputs.count();

        for (let i = 0; i < Math.min(count, 5); i++) {
            const input = inputs.nth(i);
            if (await input.isVisible()) {
                const fontSize = await input.evaluate(el => {
                    return parseFloat(window.getComputedStyle(el).fontSize);
                });
                expect(fontSize).toBeGreaterThanOrEqual(16);
            }
        }
    });
});

// ===============================================================
// Mobile: Modal Behavior
// ===============================================================
test.describe('Mobile: Modal', () => {
    test.use({ viewport: MOBILE_VIEWPORT });

    test.beforeEach(async ({ page }) => {
        test.skip(!PAT, 'PAT not provided in environment');
        await loginAndSelectDomain(page);
    });

    test('modal should be full-screen on mobile', async ({ page }) => {
        // Blur any focused input so global keydown handler fires
        await page.evaluate(() => {
            if (document.activeElement) document.activeElement.blur();
        });

        // Open keyboard shortcuts modal via ? key
        await page.evaluate(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', {
                key: '?', code: 'Slash', shiftKey: true, bubbles: true
            }));
        });

        const overlay = page.locator('#modal-overlay');
        await expect(overlay).toHaveClass(/modal-overlay--visible/, { timeout: 5000 });

        const modal = page.locator('#modal-dialog');
        const box = await modal.boundingBox();
        // Modal should take full viewport width on mobile (scrollbar may reduce by ~30px in headless)
        expect(box.width).toBeGreaterThanOrEqual(MOBILE_VIEWPORT.width - 30);
    });

    test('modal close button should have sufficient touch target', async ({ page }) => {
        await page.evaluate(() => {
            if (document.activeElement) document.activeElement.blur();
        });

        await page.evaluate(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', {
                key: '?', code: 'Slash', shiftKey: true, bubbles: true
            }));
        });

        const overlay = page.locator('#modal-overlay');
        await expect(overlay).toHaveClass(/modal-overlay--visible/, { timeout: 5000 });

        const closeBtn = page.locator('[data-action="modal-close"]');
        await expect(closeBtn).toBeVisible();

        const box = await closeBtn.boundingBox();
        // Allow 1px tolerance for sub-pixel rounding at non-integer DPR
        expect(box.width).toBeGreaterThanOrEqual(43);
        expect(box.height).toBeGreaterThanOrEqual(43);
    });
});

// ===============================================================
// Mobile: Swipe Navigation
// ===============================================================
test.describe('Mobile: Touch Swipe', () => {
    test.use({ viewport: MOBILE_VIEWPORT, hasTouch: true });

    test.beforeEach(async ({ page }) => {
        test.skip(!PAT, 'PAT not provided in environment');
        await loginAndSelectDomain(page);
    });

    test('should switch to next tab on swipe left', async ({ page }) => {
        // Verify we start on records tab
        await expect(page.locator('[data-panel="records"]')).toHaveClass(/content-panel--active/);

        const content = page.locator('#content');
        const box = await content.boundingBox();
        const centerY = box.y + box.height / 2;

        // Simulate touchstart → touchend with horizontal displacement (swipe left)
        await page.evaluate(({ startX, endX, y }) => {
            const content = document.getElementById('content');
            content.dispatchEvent(new TouchEvent('touchstart', {
                touches: [new Touch({ identifier: 0, target: content, clientX: startX, clientY: y })],
                bubbles: true
            }));
            content.dispatchEvent(new TouchEvent('touchend', {
                changedTouches: [new Touch({ identifier: 0, target: content, clientX: endX, clientY: y })],
                bubbles: true
            }));
        }, { startX: box.x + box.width - 50, endX: box.x + 50, y: centerY });

        // Should have moved to dnssec tab
        await expect(page.locator('[data-panel="dnssec"]')).toHaveClass(/content-panel--active/);
    });

    test('should switch to previous tab on swipe right', async ({ page }) => {
        // First navigate to dnssec
        await page.click('[data-tab="dnssec"]');
        await expect(page.locator('[data-panel="dnssec"]')).toHaveClass(/content-panel--active/);

        const content = page.locator('#content');
        const box = await content.boundingBox();
        const centerY = box.y + box.height / 2;

        // Simulate swipe right (start left, move right)
        await page.evaluate(({ startX, endX, y }) => {
            const content = document.getElementById('content');
            content.dispatchEvent(new TouchEvent('touchstart', {
                touches: [new Touch({ identifier: 0, target: content, clientX: startX, clientY: y })],
                bubbles: true
            }));
            content.dispatchEvent(new TouchEvent('touchend', {
                changedTouches: [new Touch({ identifier: 0, target: content, clientX: endX, clientY: y })],
                bubbles: true
            }));
        }, { startX: box.x + 50, endX: box.x + box.width - 50, y: centerY });

        // Should have moved back to records tab
        await expect(page.locator('[data-panel="records"]')).toHaveClass(/content-panel--active/);
    });
});

// ===============================================================
// Tablet (1024px) — Icon rail sidebar
// ===============================================================
test.describe('Tablet: Layout', () => {
    test.use({ viewport: { width: 900, height: 768 } });

    test.beforeEach(async ({ page }) => {
        test.skip(!PAT, 'PAT not provided in environment');
        await loginAndSelectDomain(page);
    });

    test('sidebar should show as narrow icon rail on tablet', async ({ page }) => {
        const sidebar = page.locator('#sidebar');
        const box = await sidebar.boundingBox();
        // Icon rail should be narrow (< 100px)
        expect(box.width).toBeLessThan(100);
    });

    test('nav labels should be hidden on tablet', async ({ page }) => {
        const label = page.locator('.nav__label').first();
        await expect(label).toBeHidden();
    });

    test('tab switching should still work on tablet', async ({ page }) => {
        await page.click('[data-tab="dnssec"]');
        await expect(page.locator('[data-panel="dnssec"]')).toHaveClass(/content-panel--active/);

        await page.click('[data-tab="records"]');
        await expect(page.locator('[data-panel="records"]')).toHaveClass(/content-panel--active/);
    });
});

// ===============================================================
// Small Mobile (480px) — Extra compact
// ===============================================================
test.describe('Small Mobile: Layout', () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test('auth section should fit on small screen', async ({ page }) => {
        await page.goto('/');
        const card = page.locator('#auth-card');
        await expect(card).toBeVisible();

        const box = await card.boundingBox();
        expect(box.width).toBeLessThanOrEqual(375);
    });

    test('auth card should have reduced padding', async ({ page }) => {
        await page.goto('/');
        const card = page.locator('#auth-card');
        const padding = await card.evaluate(el => {
            return parseFloat(window.getComputedStyle(el).paddingLeft);
        });
        // At 480px breakpoint, card padding reduces
        expect(padding).toBeLessThanOrEqual(24);
    });
});

// ===============================================================
// Mobile: Regression Tests — Card Layout & Toolbar
// ===============================================================
test.describe('Mobile: Card Layout Regression', () => {
    test.use({ viewport: MOBILE_VIEWPORT });

    test.beforeEach(async ({ page }) => {
        test.skip(!PAT, 'PAT not provided in environment');
        await loginAndSelectDomain(page);
    });

    test('tab bar should show all tabs without truncation', async ({ page }) => {
        const tabs = page.locator('.nav__link');
        const count = await tabs.count();
        expect(count).toBeGreaterThanOrEqual(5);

        // All tab labels should be fully visible within the viewport
        for (let i = 0; i < count; i++) {
            const tab = tabs.nth(i);
            const box = await tab.boundingBox();
            expect(box).not.toBeNull();
            // Tab should be within the viewport width
            expect(box.x + box.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
        }
    });

    test('nav links should meet 44px touch target height', async ({ page }) => {
        const links = page.locator('.nav__link');
        const count = await links.count();

        for (let i = 0; i < count; i++) {
            const link = links.nth(i);
            const box = await link.boundingBox();
            expect(box.height).toBeGreaterThanOrEqual(44);
        }
    });

    test('toolbar buttons should wrap and not overflow viewport', async ({ page }) => {
        // Toolbar actions should wrap (flex-wrap) so all buttons are reachable
        const actions = page.locator('.toolbar__actions');
        await expect(actions).toBeVisible();

        const flexWrap = await actions.evaluate(el =>
            window.getComputedStyle(el).flexWrap
        );
        expect(flexWrap).toBe('wrap');

        // All action buttons should be within the viewport
        const buttons = page.locator('.toolbar__actions .btn');
        const btnCount = await buttons.count();
        expect(btnCount).toBeGreaterThan(0);
        for (let i = 0; i < btnCount; i++) {
            const btn = buttons.nth(i);
            if (await btn.isVisible()) {
                const btnBox = await btn.boundingBox();
                expect(btnBox.x + btnBox.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
            }
        }
    });

    test('record cards should not show checkbox label text', async ({ page }) => {
        // Checkbox columns in card layout must not display a data-label pseudo-element
        const checkboxCells = page.locator('.table__td--checkbox');
        const count = await checkboxCells.count();
        if (count > 0) {
            for (let i = 0; i < Math.min(count, 3); i++) {
                const cell = checkboxCells.nth(i);
                // The ::before pseudo-element should have display:none (no visible label)
                const beforeDisplay = await cell.evaluate(el =>
                    window.getComputedStyle(el, '::before').display
                );
                expect(beforeDisplay).toBe('none');
            }
        }
    });

    test('record cards should have checkbox as first element via order', async ({ page }) => {
        const checkboxCells = page.locator('.table__td--checkbox');
        const count = await checkboxCells.count();
        if (count > 0) {
            const order = await checkboxCells.first().evaluate(el =>
                window.getComputedStyle(el).order
            );
            expect(order).toBe('-1');
        }
    });

    test('tab bar scrollbar should be hidden', async ({ page }) => {
        const sidebar = page.locator('#sidebar');
        const scrollbarWidth = await sidebar.evaluate(el =>
            window.getComputedStyle(el).scrollbarWidth
        );
        expect(scrollbarWidth).toBe('none');
    });

    test('domain dropdown should appear above the tab bar', async ({ page }) => {
        // Blur first (input may still be focused from loginAndSelectDomain),
        // then click to trigger focus handler which clears and opens dropdown
        await page.evaluate(() => document.activeElement && document.activeElement.blur());
        await page.click('#domain-search-input');
        const dropdownList = page.locator('.dropdown__list');
        await expect(dropdownList).toBeVisible({ timeout: 5000 });

        // Get computed z-index of dropdown and tab bar
        const dropdownZIndex = await dropdownList.evaluate(el =>
            parseInt(window.getComputedStyle(el).zIndex, 10)
        );
        const sidebarZIndex = await page.locator('#sidebar').evaluate(el =>
            parseInt(window.getComputedStyle(el).zIndex, 10)
        );

        // Dropdown must be stacked above the sticky tab bar
        expect(dropdownZIndex).toBeGreaterThan(sidebarZIndex);

        // Verify dropdown visually overlaps/reaches the tab bar area
        const dropdownBox = await dropdownList.boundingBox();
        const sidebarBox = await page.locator('#sidebar').boundingBox();
        // Dropdown bottom should extend past the sidebar top (overlap)
        expect(dropdownBox.y + dropdownBox.height).toBeGreaterThan(sidebarBox.y);
    });

    test('header should not be sticky on mobile (scrolls away)', async ({ page }) => {
        const header = page.locator('#app-header');
        const position = await header.evaluate(el =>
            window.getComputedStyle(el).position
        );
        expect(position).toBe('static');
    });

    test('record cards should have compact padding', async ({ page }) => {
        const row = page.locator('.table__row').first();
        await expect(row).toBeVisible();
        const padding = await row.evaluate(el =>
            parseFloat(window.getComputedStyle(el).paddingTop)
        );
        // padding-top should be --spacing-xs (4px), not --spacing-md (16px)
        expect(padding).toBeLessThanOrEqual(4);
    });

    test('record values should not have a copy button icon', async ({ page }) => {
        // Values cell should contain no btn--icon elements
        const valuesCells = page.locator('.record-values');
        const count = await valuesCells.count();
        if (count > 0) {
            const copyBtns = valuesCells.first().locator('.btn--icon, .btn--icon--sm');
            await expect(copyBtns).toHaveCount(0);
        }
    });
});

// ===============================================================
// Mobile: Nameserver Regression Tests
// ===============================================================
test.describe('Mobile: Nameserver Regression', () => {
    test.use({ viewport: MOBILE_VIEWPORT });

    test.beforeEach(async ({ page }) => {
        test.skip(!PAT, 'PAT not provided in environment');
        await loginAndSelectDomain(page);
        await page.click('[data-tab="nameservers"]');
        await expect(page.locator('[data-panel="nameservers"].content-panel--active')).toBeVisible();
        await expect(page.locator('#nameservers-table .table')).toBeVisible({ timeout: 10000 });
    });

    test('nameserver cards should hide index column', async ({ page }) => {
        const indexCells = page.locator('.table__td--ns-index');
        const count = await indexCells.count();
        if (count > 0) {
            const display = await indexCells.first().evaluate(el =>
                window.getComputedStyle(el).display
            );
            expect(display).toBe('none');
        }
    });

    test('nameserver cards should show numbered prefix', async ({ page }) => {
        const fqdnCells = page.locator('.table__td--ns-fqdn code');
        const count = await fqdnCells.count();
        expect(count).toBeGreaterThan(0);

        // The ::before pseudo-element should show the index number
        const beforeContent = await fqdnCells.first().evaluate(el =>
            window.getComputedStyle(el, '::before').content
        );
        // Should contain "1" (first nameserver index)
        expect(beforeContent).toContain('1');
    });

    test('nameserver FQDN should not show NAMESERVER label', async ({ page }) => {
        const fqdnCells = page.locator('.table__td--ns-fqdn');
        const count = await fqdnCells.count();
        if (count > 0) {
            const beforeDisplay = await fqdnCells.first().evaluate(el =>
                window.getComputedStyle(el, '::before').display
            );
            expect(beforeDisplay).toBe('none');
        }
    });
});
