// @ts-check
const { test, expect } = require('@playwright/test');

const PAT = process.env.PAT;
const DOMAIN = process.env.DOMAIN || 'galtier.top';

test.describe('Authentication', () => {

    test('should display auth screen on load', async ({ page }) => {
        await page.goto('/');

        // Auth section should be visible
        await expect(page.locator('#auth-section')).toBeVisible();
        // App section should be hidden
        await expect(page.locator('#app-section')).toBeHidden();
        // Token input should exist
        await expect(page.locator('#auth-token-input')).toBeVisible();
        // Connect button should exist
        await expect(page.locator('[data-action="connect"]')).toBeVisible();
    });

    test('should show error for empty token', async ({ page }) => {
        await page.goto('/');
        await page.click('[data-action="connect"]');

        // Should show error toast
        const toast = page.locator('.toast--error');
        await expect(toast).toBeVisible({ timeout: 5000 });
        await expect(toast).toContainText('Please enter a Personal Access Token');
    });

    test('should toggle token visibility', async ({ page }) => {
        await page.goto('/');

        const tokenInput = page.locator('#auth-token-input');
        await expect(tokenInput).toHaveAttribute('type', 'password');

        await page.click('[data-action="toggle-token-visibility"]');
        await expect(tokenInput).toHaveAttribute('type', 'text');

        await page.click('[data-action="toggle-token-visibility"]');
        await expect(tokenInput).toHaveAttribute('type', 'password');
    });

    test('should have storage mode radio buttons', async ({ page }) => {
        await page.goto('/');

        const memoryRadio = page.locator('input[name="storage-mode"][value="memory"]');
        const sessionRadio = page.locator('input[name="storage-mode"][value="session"]');
        const localRadio = page.locator('input[name="storage-mode"][value="local"]');

        await expect(memoryRadio).toBeVisible();
        await expect(sessionRadio).toBeVisible();
        await expect(localRadio).toBeVisible();

        // Session should be checked by default
        await expect(sessionRadio).toBeChecked();
    });

    test('should connect with valid PAT and show app', async ({ page }) => {
        test.skip(!PAT, 'PAT not provided in environment');

        await page.goto('/');

        // Enter the PAT
        await page.fill('#auth-token-input', PAT);
        await page.click('[data-action="connect"]');

        // Wait for the app section to appear (API call might take a moment)
        await expect(page.locator('#app-section')).toBeVisible({ timeout: 15000 });
        // Auth section should be hidden
        await expect(page.locator('#auth-section')).toBeHidden();
    });

    test('should not flash auth screen on reload with stored token', async ({ page }) => {
        test.skip(!PAT, 'PAT not provided in environment');

        // 1. Connect normally (session storage mode — the default)
        await page.goto('/');
        await page.fill('#auth-token-input', PAT);
        await page.click('[data-action="connect"]');
        await expect(page.locator('#app-section')).toBeVisible({ timeout: 15000 });

        // 2. Install a MutationObserver BEFORE reload to detect any flash
        //    of the auth-section. The observer runs synchronously in the
        //    new page context via addInitScript, so it catches visibility
        //    changes that happen before our application JS executes.
        await page.addInitScript(() => {
            window.__authFlashDetected = false;
            const observer = new MutationObserver(() => {
                const authEl = document.getElementById('auth-section');
                if (authEl && !authEl.classList.contains('hidden') && !authEl.hidden) {
                    window.__authFlashDetected = true;
                }
            });
            observer.observe(document.documentElement, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'hidden']
            });
        });

        // 3. Reload the page
        await page.reload({ waitUntil: 'domcontentloaded' });

        // 4. App section should be visible immediately (no flash of auth)
        await expect(page.locator('#app-section')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#auth-section')).toBeHidden();

        // 5. Verify the MutationObserver never saw auth-section as visible
        const flashDetected = await page.evaluate(() => window.__authFlashDetected);
        expect(flashDetected).toBe(false);

        // 6. Re-authentication should succeed — domains should load
        await expect(page.locator('#domain-search-input')).toBeVisible({ timeout: 15000 });
    });

    test('should show error for invalid PAT', async ({ page }) => {
        await page.goto('/');

        await page.fill('#auth-token-input', 'invalid-token-12345');
        await page.click('[data-action="connect"]');

        // Should show error toast
        const toast = page.locator('.toast--error');
        await expect(toast).toBeVisible({ timeout: 15000 });
    });
});
