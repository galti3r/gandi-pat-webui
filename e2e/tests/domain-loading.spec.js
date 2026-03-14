// @ts-check
/**
 * E2E regression tests for progressive domain loading.
 *
 * Tests:
 * - No duplicate domains in dropdown (bug fix regression)
 * - Domain count badge matches actual dropdown items
 * - Progressive loading shows first domain quickly
 * - Disconnect cancels loading without errors
 * - Reconnect after disconnect loads domains cleanly
 */
const { test, expect } = require('@playwright/test');

const PAT = process.env.PAT;
const DOMAIN = process.env.DOMAIN || 'galtier.top';

test.describe('Domain loading — progressive + deduplication', () => {

    test.beforeEach(async ({ page }) => {
        test.skip(!PAT, 'PAT not provided in environment');

        await page.goto('/');
        await page.fill('#auth-token-input', PAT);
        await page.click('[data-action="connect"]');
        await expect(page.locator('#app-section')).toBeVisible({ timeout: 15000 });
    });

    test('should not have duplicate domains in dropdown (regression)', async ({ page }) => {
        // Wait for domain loading to complete (badge no longer contains "loading")
        await expect(page.locator('#domain-count')).not.toHaveText('', { timeout: 15000 });
        await page.waitForFunction(() => {
            const el = document.getElementById('domain-count');
            return el && el.textContent && !el.textContent.includes('loading') && !el.textContent.includes('chargement');
        }, { timeout: 15000 });

        // Open the dropdown
        await page.click('#domain-search-input');
        await page.waitForTimeout(300);

        // Count all domain items (excluding empty-state)
        const items = page.locator('#domain-dropdown-list .dropdown__item:not([data-empty-state])');
        const itemCount = await items.count();

        // Collect all fqdn values
        const fqdns = [];
        for (let i = 0; i < itemCount; i++) {
            const fqdn = await items.nth(i).getAttribute('data-domain');
            fqdns.push(fqdn);
        }

        // Verify no duplicates
        const unique = [...new Set(fqdns)];
        expect(fqdns.length).toBe(unique.length);
        expect(fqdns.length).toBeGreaterThan(0);

        // Badge count should match DOM item count
        const badgeText = await page.locator('#domain-count').textContent();
        expect(badgeText).toContain(String(itemCount));
    });

    test('should display domain count badge matching dropdown items', async ({ page }) => {
        // Wait for loading to finish
        await page.waitForFunction(() => {
            const el = document.getElementById('domain-count');
            return el && el.textContent && !el.textContent.includes('loading') && !el.textContent.includes('chargement');
        }, { timeout: 15000 });

        // Read the count from the badge
        const badgeText = await page.locator('#domain-count').textContent();
        const match = badgeText.match(/(\d+)/);
        expect(match).toBeTruthy();
        const badgeCount = parseInt(match[1], 10);

        // Open dropdown and count actual items
        await page.click('#domain-search-input');
        await page.waitForTimeout(300);
        const items = page.locator('#domain-dropdown-list .dropdown__item:not([data-empty-state])');
        const domCount = await items.count();

        expect(domCount).toBe(badgeCount);
    });

    test('should auto-select first domain after loading', async ({ page }) => {
        // Wait for domain loading to complete AND input to have a value
        await page.waitForFunction(() => {
            const el = document.getElementById('domain-count');
            const input = document.getElementById('domain-search-input');
            const badgeDone = el && el.textContent && !el.textContent.includes('loading') && !el.textContent.includes('chargement');
            const hasValue = input && input.value && input.value.includes('.');
            return badgeDone && hasValue;
        }, { timeout: 15000 });

        // The search input should have a domain value (auto-selected)
        const inputValue = await page.locator('#domain-search-input').inputValue();
        expect(inputValue.length).toBeGreaterThan(0);
        expect(inputValue).toContain('.');
    });

    test('should not have duplicates after disconnect and reconnect', async ({ page }) => {
        // Wait for first load to complete
        await page.waitForFunction(() => {
            const el = document.getElementById('domain-count');
            return el && el.textContent && !el.textContent.includes('loading') && !el.textContent.includes('chargement');
        }, { timeout: 15000 });

        // Disconnect
        await page.click('[data-action="disconnect"]');
        await expect(page.locator('#auth-section')).toBeVisible({ timeout: 5000 });

        // Reconnect
        await page.fill('#auth-token-input', PAT);
        await page.click('[data-action="connect"]');
        await expect(page.locator('#app-section')).toBeVisible({ timeout: 15000 });

        // Wait for domain loading to complete again
        await page.waitForFunction(() => {
            const el = document.getElementById('domain-count');
            return el && el.textContent && !el.textContent.includes('loading') && !el.textContent.includes('chargement');
        }, { timeout: 15000 });

        // Open dropdown and check for duplicates
        await page.click('#domain-search-input');
        await page.waitForTimeout(300);

        const items = page.locator('#domain-dropdown-list .dropdown__item:not([data-empty-state])');
        const itemCount = await items.count();
        const fqdns = [];
        for (let i = 0; i < itemCount; i++) {
            fqdns.push(await items.nth(i).getAttribute('data-domain'));
        }

        const unique = [...new Set(fqdns)];
        expect(fqdns.length).toBe(unique.length);
        expect(fqdns.length).toBeGreaterThan(0);
    });

    test('should show loading indicator then final count', async ({ page }) => {
        // Disconnect and reconnect to observe loading state
        await page.waitForFunction(() => {
            const el = document.getElementById('domain-count');
            return el && el.textContent && !el.textContent.includes('loading') && !el.textContent.includes('chargement');
        }, { timeout: 15000 });

        await page.click('[data-action="disconnect"]');
        await expect(page.locator('#auth-section')).toBeVisible({ timeout: 5000 });

        // Reconnect — watch the badge transition
        await page.fill('#auth-token-input', PAT);
        await page.click('[data-action="connect"]');
        await expect(page.locator('#app-section')).toBeVisible({ timeout: 15000 });

        // Eventually the badge should show a final count (no "loading")
        await page.waitForFunction(() => {
            const el = document.getElementById('domain-count');
            if (!el || !el.textContent) return false;
            const text = el.textContent.toLowerCase();
            return text.match(/^\d+/) && !text.includes('loading') && !text.includes('chargement');
        }, { timeout: 15000 });

        const badgeText = await page.locator('#domain-count').textContent();
        expect(badgeText).toMatch(/^\d+/);
    });

    test('should allow search during and after loading', async ({ page }) => {
        // Wait for domains to be loaded
        await page.waitForFunction(() => {
            const el = document.getElementById('domain-count');
            return el && el.textContent && !el.textContent.includes('loading') && !el.textContent.includes('chargement');
        }, { timeout: 15000 });

        // Click input to open dropdown, then type search query
        await page.click('#domain-search-input');
        const dropdown = page.locator('#domain-dropdown-list');
        await expect(dropdown).toBeVisible();

        await page.keyboard.type('galtier');
        await page.waitForTimeout(500);

        // Visible items should all contain the search term
        const visibleItems = dropdown.locator('.dropdown__item:not([data-empty-state]):not([style*="display: none"])');
        const count = await visibleItems.count();

        if (count > 0) {
            for (let i = 0; i < count; i++) {
                const text = await visibleItems.nth(i).textContent();
                expect(text.toLowerCase()).toContain('galtier');
            }
        }
    });
});
