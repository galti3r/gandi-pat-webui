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

test.describe('DNSSEC Tab', () => {
    test.beforeEach(async ({ page }) => {
        test.skip(!PAT, 'PAT not provided in environment');
        await loginAndSelectDomain(page);
    });

    test('should navigate to DNSSEC tab', async ({ page }) => {
        await page.click('[data-tab="dnssec"]');

        // DNSSEC panel should be visible
        const panel = page.locator('#content-dnssec');
        await expect(panel).toBeVisible({ timeout: 5000 });
    });

    test('should display DNSSEC keys or empty state', async ({ page }) => {
        await page.click('[data-tab="dnssec"]');
        await page.waitForTimeout(3000);

        const panel = page.locator('#content-dnssec');
        await expect(panel).toBeVisible();

        // Should show either a keys table or an empty state message
        const hasTable = await panel.locator('.table').count() > 0;
        const hasEmpty = await panel.locator('.table-empty').count() > 0;
        expect(hasTable || hasEmpty).toBeTruthy();
    });

    test('should show managed-by-Gandi note', async ({ page }) => {
        await page.click('[data-tab="dnssec"]');
        await page.waitForTimeout(3000);

        const note = page.locator('#content-dnssec .info-note');
        await expect(note).toBeVisible();
        await expect(note).toContainText('managed by Gandi');
    });
});
