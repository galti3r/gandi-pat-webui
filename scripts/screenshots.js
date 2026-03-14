// Screenshot capture script for Gandi DNS WebUI
// Uses Playwright with real Google Chrome to capture key views
'use strict';

const { chromium } = require('playwright');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';
const PAT = process.env.PAT;
const DOMAIN = process.env.DOMAIN || 'galtier.top';
const OUTPUT_DIR = process.env.OUTPUT_DIR || 'docs/screenshots';

const DESKTOP = { width: 1280, height: 800 };
const MOBILE  = { width: 390,  height: 844 };

const JPEG = { type: 'jpeg', quality: 85 };

if (!PAT) {
    console.error('Error: PAT environment variable is required');
    process.exit(1);
}

function shot(name) {
    return { ...JPEG, path: path.join(OUTPUT_DIR, name) };
}

async function capture() {
    console.log(`Base URL: ${BASE_URL}`);
    console.log(`Output:   ${OUTPUT_DIR}`);
    console.log(`Domain:   ${DOMAIN || '(first available)'}`);
    console.log('');

    const browser = await chromium.launch({ channel: 'chrome' });

    try {
        const context = await browser.newContext({
            viewport: DESKTOP,
            colorScheme: 'dark'
        });
        const page = await context.newPage();

        // === DESKTOP SCREENSHOTS ===

        // --- 01: Auth page ---
        console.log('[01/10] Auth page...');
        await page.goto(BASE_URL);
        await page.waitForSelector('#auth-section', { state: 'visible', timeout: 10000 });
        await page.waitForTimeout(500);
        await page.screenshot(shot('01-auth.jpg'));
        console.log('  -> 01-auth.jpg');

        // --- Login ---
        console.log('  Logging in...');
        await page.fill('#auth-token-input', PAT);
        await page.click('[data-action="connect"]');
        await page.waitForSelector('#app-section', { state: 'visible', timeout: 15000 });
        // Wait for domain count to be populated (non-empty text)
        await page.locator('#domain-count:not(:empty)').waitFor({ timeout: 10000 });
        console.log('  Domains loaded.');

        // --- Select domain ---
        await page.click('#domain-search-input');
        await page.waitForTimeout(500);

        if (DOMAIN) {
            const domainItem = page.locator(`[data-domain="${DOMAIN}"]`);
            if (await domainItem.count() > 0) {
                await domainItem.click();
                console.log(`  Selected domain: ${DOMAIN}`);
            } else {
                console.error(`Error: domain "${DOMAIN}" not found`);
                process.exit(1);
            }
        } else {
            const firstDomain = page.locator('[data-domain]').first();
            await firstDomain.waitFor({ state: 'visible', timeout: 5000 });
            const domainName = await firstDomain.getAttribute('data-domain');
            await firstDomain.click();
            console.log(`  Selected domain: ${domainName}`);
        }

        await page.locator('#content-records .table, #content-records .content-panel__empty')
            .waitFor({ state: 'visible', timeout: 15000 });
        await page.waitForTimeout(1000);

        // --- 02: Records table (dark mode) ---
        console.log('[02/10] Records table (dark mode)...');
        await page.screenshot(shot('02-records-dark.jpg'));
        console.log('  -> 02-records-dark.jpg');

        // --- 03: Records table (light mode) ---
        console.log('[03/10] Records table (light mode)...');
        await page.click('[data-action="toggle-theme"]');
        await page.waitForTimeout(500);
        await page.screenshot(shot('03-records-light.jpg'));
        console.log('  -> 03-records-light.jpg');

        // --- 04: Add record modal ---
        console.log('[04/10] Add record modal...');
        await page.click('[data-action="add-record"]');
        await page.waitForSelector('#modal-overlay', { state: 'visible', timeout: 5000 });
        await page.waitForTimeout(500);
        await page.screenshot(shot('04-record-form.jpg'));
        console.log('  -> 04-record-form.jpg');

        // Close modal
        await page.click('[data-action="modal-close"]');
        await page.waitForSelector('#modal-overlay', { state: 'hidden', timeout: 5000 });

        // --- 05: DNSSEC tab ---
        console.log('[05/10] DNSSEC tab...');
        await page.click('[data-tab="dnssec"]');
        await page.waitForSelector('[data-panel="dnssec"]', { state: 'visible', timeout: 5000 });
        await page.waitForTimeout(1000);
        await page.screenshot(shot('05-dnssec.jpg'));
        console.log('  -> 05-dnssec.jpg');

        // --- 06: Nameservers tab ---
        console.log('[06/10] Nameservers tab...');
        await page.click('[data-tab="nameservers"]');
        await page.waitForSelector('[data-panel="nameservers"]', { state: 'visible', timeout: 5000 });
        await page.waitForTimeout(1000);
        await page.screenshot(shot('06-nameservers.jpg'));
        console.log('  -> 06-nameservers.jpg');

        // --- 07: History tab ---
        console.log('[07/10] History tab...');
        await page.click('[data-tab="history"]');
        await page.waitForSelector('[data-panel="history"]', { state: 'visible', timeout: 5000 });
        await page.waitForTimeout(1000);
        await page.screenshot(shot('07-history.jpg'));
        console.log('  -> 07-history.jpg');

        // === MOBILE SCREENSHOTS ===

        // Switch back to records tab and dark mode
        await page.click('[data-action="toggle-theme"]');
        await page.waitForTimeout(300);
        await page.click('[data-tab="records"]');
        await page.locator('#content-records .table, #content-records .content-panel__empty')
            .waitFor({ state: 'visible', timeout: 5000 });

        await page.setViewportSize(MOBILE);
        await page.waitForTimeout(500);

        // --- 08: Mobile records (top) ---
        console.log('[08/10] Mobile records...');
        await page.screenshot(shot('08-mobile-records.jpg'));
        console.log('  -> 08-mobile-records.jpg');

        // --- 09: Mobile records (scrolled — sticky tab bar, no header) ---
        console.log('[09/10] Mobile records scrolled...');
        await page.evaluate(() => window.scrollBy(0, 400));
        await page.waitForTimeout(300);
        await page.screenshot(shot('09-mobile-records-scrolled.jpg'));
        console.log('  -> 09-mobile-records-scrolled.jpg');

        // --- 10: Mobile nameservers ---
        console.log('[10/10] Mobile nameservers...');
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.click('[data-tab="nameservers"]');
        await page.waitForSelector('[data-panel="nameservers"]', { state: 'visible', timeout: 5000 });
        await page.waitForTimeout(1000);
        await page.screenshot(shot('10-mobile-nameservers.jpg'));
        console.log('  -> 10-mobile-nameservers.jpg');

        console.log('');
        console.log('All 10 screenshots captured successfully.');

    } catch (err) {
        console.error('Screenshot capture failed:', err.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
}

capture();
