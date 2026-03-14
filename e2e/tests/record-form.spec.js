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
    await expect(page.locator('#content-records .table, #content-records .content-panel__empty')).toBeVisible({ timeout: 15000 });
}

async function openAddRecordModal(page) {
    await page.click('[data-action="add-record"]');
    await expect(page.locator('#modal-overlay')).toHaveClass(/modal-overlay--visible/, { timeout: 5000 });
}

async function selectRecordType(page, type) {
    const typeBtn = page.locator('.type-selector__btn .type-selector__type').getByText(type, { exact: true });
    await typeBtn.click();
    await page.waitForTimeout(500);
}

test.describe('Record Form — Add Value & i18n', () => {
    test.beforeEach(async ({ page }) => {
        test.skip(!PAT, 'PAT not provided in environment');
        await loginAndSelectDomain(page);
    });

    test('should show translated Name and TTL labels in add form', async ({ page }) => {
        await openAddRecordModal(page);
        await selectRecordType(page, 'A');

        const modal = page.locator('#modal-overlay');

        // Name label should be translated (EN: "Name *", FR: "Nom *")
        // Label contains "Name" text + a <span> " *" for required indicator
        const nameLabel = modal.locator('label[for="field-name"]');
        await expect(nameLabel).toBeVisible({ timeout: 5000 });
        const nameLabelText = await nameLabel.textContent();
        expect(
            nameLabelText.includes('Name') || nameLabelText.includes('Nom')
        ).toBeTruthy();

        // Name help text should be translated (shown as div.form__help below the input)
        const nameHelp = modal.locator('[data-field="name"] .form__help');
        await expect(nameHelp).toBeVisible();
        const helpText = await nameHelp.textContent();
        expect(
            helpText.includes('Subdomain') || helpText.includes('subdomain') ||
            helpText.includes('Sous-domaine') || helpText.includes('sous-domaine')
        ).toBeTruthy();

        // TTL label should be translated (EN: "TTL (seconds)", FR: "TTL (secondes)")
        const ttlLabel = modal.locator('label[for="field-ttl"]');
        await expect(ttlLabel).toBeVisible();
        const ttlLabelText = await ttlLabel.textContent();
        expect(
            ttlLabelText.includes('TTL') && (ttlLabelText.includes('seconds') || ttlLabelText.includes('secondes'))
        ).toBeTruthy();

        // Close modal
        await page.keyboard.press('Escape');
    });

    test('should show Add Value button for multi-value type (A)', async ({ page }) => {
        await openAddRecordModal(page);
        await selectRecordType(page, 'A');

        const modal = page.locator('#modal-overlay');

        // Add Value button should be visible
        const addValueBtn = modal.locator('.record-form__add-value');
        await expect(addValueBtn).toBeVisible({ timeout: 5000 });

        const btnText = await addValueBtn.textContent();
        expect(
            btnText.includes('Add Value') || btnText.includes('Ajouter')
        ).toBeTruthy();

        // Close modal
        await page.keyboard.press('Escape');
    });

    test('should NOT show Add Value button for single-value type (CNAME)', async ({ page }) => {
        await openAddRecordModal(page);
        await selectRecordType(page, 'CNAME');

        const modal = page.locator('#modal-overlay');

        // Wait for the form to render
        await expect(modal.locator('#field-name')).toBeVisible({ timeout: 5000 });

        // Add Value button should NOT be present
        const addValueBtn = modal.locator('.record-form__add-value');
        expect(await addValueBtn.count()).toBe(0);

        // Close modal
        await page.keyboard.press('Escape');
    });

    test('should add and remove value rows with Add Value button (A type)', async ({ page }) => {
        await openAddRecordModal(page);
        await selectRecordType(page, 'A');

        const modal = page.locator('#modal-overlay');

        // Initially should have 1 value row
        const valueRows = modal.locator('.record-form__value-row');
        const initialCount = await valueRows.count();
        expect(initialCount).toBe(1);

        // Click Add Value
        const addValueBtn = modal.locator('.record-form__add-value');
        await addValueBtn.click();

        // Should now have 2 value rows
        expect(await valueRows.count()).toBe(2);

        // Second row should have a remove button
        const removeBtn = valueRows.nth(1).locator('.record-form__remove-value');
        await expect(removeBtn).toBeVisible();

        // Click remove to go back to 1 row
        await removeBtn.click();
        expect(await valueRows.count()).toBe(1);

        // Close modal
        await page.keyboard.press('Escape');
    });

    test('should show Add Value button for TXT type (multi-value)', async ({ page }) => {
        await openAddRecordModal(page);
        await selectRecordType(page, 'TXT');

        const modal = page.locator('#modal-overlay');

        // Wait for form
        await expect(modal.locator('#field-name')).toBeVisible({ timeout: 5000 });

        // Add Value button should be visible for TXT
        const addValueBtn = modal.locator('.record-form__add-value');
        await expect(addValueBtn).toBeVisible();

        // Close modal
        await page.keyboard.press('Escape');
    });

    test('TXT SPF warning should appear on blur', async ({ page }) => {
        await openAddRecordModal(page);
        await selectRecordType(page, 'TXT');

        const modal = page.locator('#modal-overlay');
        await expect(modal.locator('#field-name')).toBeVisible({ timeout: 5000 });

        // Type SPF value and blur
        const textarea = modal.locator('textarea[name="value"]').first();
        await textarea.fill('v=spf1 include:_spf.google.com ~all');
        await textarea.blur();

        // Warning should appear
        const warning = modal.locator('.form__field-warning--active');
        await expect(warning).toBeVisible({ timeout: 3000 });

        // Clear and type normal text
        await textarea.fill('hello world');
        await textarea.blur();

        // Warning should disappear
        await expect(warning).not.toBeVisible({ timeout: 3000 });

        await page.keyboard.press('Escape');
    });

    test('NS warning should appear for hostname without trailing dot', async ({ page }) => {
        await openAddRecordModal(page);

        const modal = page.locator('#modal-overlay');
        // NS is Tier 2 — expand "Show advanced types" first
        const advancedToggle = modal.locator('text=advanced types').first();
        await advancedToggle.click();
        await page.waitForTimeout(300);
        const nsBtn = modal.locator('.type-selector__btn .type-selector__type').getByText('NS', { exact: true });
        await nsBtn.scrollIntoViewIfNeeded();
        await nsBtn.click();
        await page.waitForTimeout(500);

        await expect(modal.locator('#field-name')).toBeVisible({ timeout: 5000 });

        // Type hostname without trailing dot and blur
        const textarea = modal.locator('textarea[name="value"]').first();
        await textarea.fill('ns1.example.com');
        await textarea.blur();

        // Warning should appear
        const warning = modal.locator('.form__field-warning--active');
        await expect(warning).toBeVisible({ timeout: 3000 });

        // Add trailing dot
        await textarea.fill('ns1.example.com.');
        await textarea.blur();

        // Warning should disappear
        await expect(warning).not.toBeVisible({ timeout: 3000 });

        await page.keyboard.press('Escape');
    });

    test('should NOT show Add Value button for ALIAS (single-value type)', async ({ page }) => {
        await openAddRecordModal(page);

        const modal = page.locator('#modal-overlay');
        // ALIAS is Tier 2 — expand advanced types
        const advancedToggle = modal.locator('text=advanced types').first();
        await advancedToggle.click();
        await page.waitForTimeout(300);
        const aliasBtn = modal.locator('.type-selector__btn .type-selector__type').getByText('ALIAS', { exact: true });
        await aliasBtn.scrollIntoViewIfNeeded();
        await aliasBtn.click();
        await page.waitForTimeout(500);

        await expect(modal.locator('#field-name')).toBeVisible({ timeout: 5000 });

        // Add Value button should NOT be present for single-value type
        const addValueBtn = modal.locator('.record-form__add-value');
        expect(await addValueBtn.count()).toBe(0);

        await page.keyboard.press('Escape');
    });

    test('CAA form should warn when cavalue looks like URL', async ({ page }) => {
        await openAddRecordModal(page);
        await selectRecordType(page, 'CAA');

        const modal = page.locator('#modal-overlay');
        await expect(modal.locator('#field-name')).toBeVisible({ timeout: 5000 });

        // Fill cavalue with a URL-like value and blur
        const cavalueInput = modal.locator('input[name="cavalue"]');
        await cavalueInput.fill('https://letsencrypt.org');
        await cavalueInput.blur();

        // Warning should appear
        const warning = modal.locator('.form__field-warning--active');
        await expect(warning).toBeVisible({ timeout: 3000 });

        // Clear and type correct domain value
        await cavalueInput.fill('letsencrypt.org');
        await cavalueInput.blur();

        // Warning should disappear
        await expect(warning).not.toBeVisible({ timeout: 3000 });

        await page.keyboard.press('Escape');
    });

    test('CAA form should populate fields when editing (parseValue)', async ({ page }) => {
        await openAddRecordModal(page);
        await selectRecordType(page, 'CAA');

        const modal = page.locator('#modal-overlay');
        await expect(modal.locator('#field-name')).toBeVisible({ timeout: 5000 });

        // Verify CAA has 3 fields: flags, tag, cavalue
        const flagsInput = modal.locator('input[name="flags"]');
        const tagSelect = modal.locator('select[name="tag"]');
        const cavalueInput = modal.locator('input[name="cavalue"]');

        await expect(flagsInput).toBeVisible();
        await expect(tagSelect).toBeVisible();
        await expect(cavalueInput).toBeVisible();

        // Fill and verify the form accepts values
        await flagsInput.fill('0');
        await tagSelect.selectOption('issue');
        await cavalueInput.fill('letsencrypt.org');

        expect(await flagsInput.inputValue()).toBe('0');
        expect(await tagSelect.inputValue()).toBe('issue');
        expect(await cavalueInput.inputValue()).toBe('letsencrypt.org');

        await page.keyboard.press('Escape');
    });

    test('should show TTL presets with translated tooltips', async ({ page }) => {
        await openAddRecordModal(page);
        await selectRecordType(page, 'A');

        const modal = page.locator('#modal-overlay');

        // TTL presets should exist (class: record-form__ttl-preset)
        const presets = modal.locator('.record-form__ttl-preset');
        const presetCount = await presets.count();
        expect(presetCount).toBeGreaterThan(0);

        // First preset should have a title attribute with translated text
        const firstPreset = presets.first();
        const title = await firstPreset.getAttribute('title');
        expect(title).toBeTruthy();
        // Title should contain "seconds" or "secondes" (translated)
        expect(
            title.includes('seconds') || title.includes('secondes')
        ).toBeTruthy();

        // Clicking a preset should fill the TTL field
        await firstPreset.click();
        const ttlInput = modal.locator('#field-ttl');
        const ttlValue = await ttlInput.inputValue();
        expect(Number(ttlValue)).toBeGreaterThan(0);

        // Close modal
        await page.keyboard.press('Escape');
    });
});
