// @ts-check
const { test, expect } = require('@playwright/test');

const PAT = process.env.PAT;
const DOMAIN = process.env.DOMAIN || 'galtier.top';

test.describe('Navigation & UI', () => {
    test('should have correct page title', async ({ page }) => {
        await page.goto('/');
        await expect(page).toHaveTitle('Gandi DNS Manager');
    });

    test('should have no-referrer meta tag', async ({ page }) => {
        await page.goto('/');
        const meta = page.locator('meta[name="referrer"]');
        await expect(meta).toHaveAttribute('content', 'no-referrer');
    });

    test('should have viewport meta tag', async ({ page }) => {
        await page.goto('/');
        const meta = page.locator('meta[name="viewport"]');
        await expect(meta).toHaveAttribute('content', 'width=device-width, initial-scale=1.0');
    });
});

// Helper: authenticate and select a domain so panels have content
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

    // Wait for records to load so panels have content
    await expect(page.locator('#content-records .table, #content-records .content-panel__empty')).toBeVisible({ timeout: 15000 });
}

test.describe('Navigation (authenticated)', () => {
    test.beforeEach(async ({ page }) => {
        test.skip(!PAT, 'PAT not provided in environment');
        await loginAndSelectDomain(page);
    });

    test('should switch tabs via sidebar navigation', async ({ page }) => {
        // Click DNSSEC tab
        await page.click('[data-tab="dnssec"]');
        await expect(page.locator('[data-panel="dnssec"]')).toHaveClass(/content-panel--active/);
        await expect(page.locator('[data-panel="records"]')).not.toHaveClass(/content-panel--active/);

        // Click Nameservers tab
        await page.click('[data-tab="nameservers"]');
        await expect(page.locator('[data-panel="nameservers"]')).toHaveClass(/content-panel--active/);
        await expect(page.locator('[data-panel="dnssec"]')).not.toHaveClass(/content-panel--active/);

        // Click Settings tab
        await page.click('[data-tab="settings"]');
        await expect(page.locator('[data-panel="settings"]')).toHaveClass(/content-panel--active/);
        await expect(page.locator('[data-panel="nameservers"]')).not.toHaveClass(/content-panel--active/);

        // Click Records tab (back to default)
        await page.click('[data-tab="records"]');
        await expect(page.locator('[data-panel="records"]')).toHaveClass(/content-panel--active/);
        await expect(page.locator('[data-panel="settings"]')).not.toHaveClass(/content-panel--active/);
    });

    test('should update URL hash when switching tabs', async ({ page }) => {
        await page.click('[data-tab="dnssec"]');
        await page.waitForTimeout(300);
        expect(page.url()).toContain('#dnssec');

        await page.click('[data-tab="nameservers"]');
        await page.waitForTimeout(300);
        expect(page.url()).toContain('#nameservers');

        await page.click('[data-tab="settings"]');
        await page.waitForTimeout(300);
        expect(page.url()).toContain('#settings');
    });

    test('should highlight active tab in sidebar', async ({ page }) => {
        await page.click('[data-tab="dnssec"]');
        await page.waitForTimeout(300);

        const activeLink = page.locator('[data-tab="dnssec"]');
        await expect(activeLink).toHaveClass(/nav__link--active/);

        const inactiveLink = page.locator('[data-tab="records"]');
        await expect(inactiveLink).not.toHaveClass(/nav__link--active/);
    });

    test('should display settings panel with version info', async ({ page }) => {
        await page.click('[data-tab="settings"]');
        await page.waitForTimeout(500);

        const settings = page.locator('#content-settings');
        await expect(settings).toContainText('Settings');
        await expect(settings).toContainText('Gandi DNS Manager');
        await expect(settings).toContainText('1.1.1');
    });

    test('should toggle theme', async ({ page }) => {
        // Default should be dark
        await expect(page.locator('body')).toHaveClass(/theme-dark/);

        // Click theme toggle
        await page.click('[data-action="toggle-theme"]');
        await expect(page.locator('body')).toHaveClass(/theme-light/);

        // Toggle back
        await page.click('[data-action="toggle-theme"]');
        await expect(page.locator('body')).toHaveClass(/theme-dark/);
    });

    test('should disconnect and return to auth screen', async ({ page }) => {
        await page.click('[data-action="disconnect"]');

        await expect(page.locator('#auth-section')).toBeVisible();
        await expect(page.locator('#app-section')).toBeHidden();

        // Should show disconnected toast
        const toast = page.locator('.toast--info');
        await expect(toast).toBeVisible({ timeout: 5000 });
        await expect(toast).toContainText('Disconnected');
    });

    test('should show keyboard shortcuts modal with ? key', async ({ page }) => {
        // Blur any focused element so the global keydown handler fires
        await page.evaluate(() => {
            if (document.activeElement) document.activeElement.blur();
        });
        await page.waitForTimeout(300);

        // Dispatch a ? keydown event directly (Playwright's keyboard may
        // not map Shift+/ to event.key === '?' on all layouts)
        await page.evaluate(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', {
                key: '?', code: 'Slash', shiftKey: true, bubbles: true
            }));
        });
        await page.waitForTimeout(500);

        // Modal should appear with shortcuts info
        const modal = page.locator('#modal-overlay');
        await expect(modal).toHaveClass(/modal-overlay--visible/, { timeout: 5000 });
        await expect(modal).toContainText('Keyboard Shortcuts');
    });
});
