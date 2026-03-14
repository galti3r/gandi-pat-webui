// @ts-check
const { test, expect } = require('@playwright/test');

const PAT = process.env.PAT;
const DOMAIN = process.env.DOMAIN || 'galtier.top';

test.describe('Domains', () => {
    test.beforeEach(async ({ page }) => {
        test.skip(!PAT, 'PAT not provided in environment');

        await page.goto('/');
        await page.fill('#auth-token-input', PAT);
        await page.click('[data-action="connect"]');
        await expect(page.locator('#app-section')).toBeVisible({ timeout: 15000 });
    });

    test('should load and display domain list', async ({ page }) => {
        // Domain count badge should appear
        const domainCount = page.locator('#domain-count');
        await expect(domainCount).not.toHaveText('', { timeout: 10000 });

        // Domain search input should be visible
        await expect(page.locator('#domain-search-input')).toBeVisible();
    });

    test('should show dropdown when clicking search input', async ({ page }) => {
        // Wait for domains to load
        await expect(page.locator('#domain-count')).not.toHaveText('', { timeout: 10000 });

        // Click on the search input to open dropdown
        await page.click('#domain-search-input');

        const dropdown = page.locator('#domain-dropdown-list');
        await expect(dropdown).toBeVisible();
    });

    test('should select the test domain', async ({ page }) => {
        // Wait for domains to load
        await expect(page.locator('#domain-count')).not.toHaveText('', { timeout: 10000 });

        // Open dropdown and click on the domain
        await page.click('#domain-search-input');
        await page.waitForTimeout(500);

        // Click on the target domain item
        const domainItem = page.locator(`[data-domain="${DOMAIN}"]`);
        const domainExists = await domainItem.count() > 0;
        test.skip(!domainExists, `Domain ${DOMAIN} not found in account`);

        await domainItem.click();

        // Input should now show the selected domain
        await expect(page.locator('#domain-search-input')).toHaveValue(DOMAIN);
    });

    test('should filter domains by search text', async ({ page }) => {
        // Wait for domains to load
        await expect(page.locator('#domain-count')).not.toHaveText('', { timeout: 10000 });

        // Click input to open dropdown (focus clears value and shows all)
        await page.click('#domain-search-input');
        await expect(page.locator('#domain-dropdown-list')).toBeVisible();

        // Type partial domain name (keyboard, not fill — preserves focus)
        await page.keyboard.type('galtier');
        await page.waitForTimeout(500);

        // The dropdown should still be visible with filtered results
        const dropdown = page.locator('#domain-dropdown-list');
        await expect(dropdown).toBeVisible();

        // At least one visible item should exist
        const visibleItems = dropdown.locator('.dropdown__item:not([style*="display: none"])');
        await expect(visibleItems.first()).toBeVisible();
    });
});
