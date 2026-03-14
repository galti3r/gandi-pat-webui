// @ts-check
const { defineConfig } = require('@playwright/test');

const isContainerized = !!process.env.CONTAINERIZED;
const testPort = parseInt(process.env.TEST_PORT || '8001', 10);

module.exports = defineConfig({
    testDir: './tests',
    timeout: 60000,
    expect: {
        timeout: 10000
    },
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
    use: {
        baseURL: process.env.BASE_URL || `http://localhost:${testPort}`,
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure'
    },
    projects: [
        {
            name: 'chromium',
            use: {
                browserName: 'chromium',
                channel: undefined
            },
            testIgnore: /mobile\.spec/
        },
        {
            name: 'mobile',
            use: {
                browserName: 'chromium',
                channel: undefined
            },
            testMatch: /mobile\.spec/
        }
    ],
    ...(!isContainerized && {
        webServer: {
            command: `python3 ../cors-proxy.py --port ${testPort}`,
            port: testPort,
            reuseExistingServer: !process.env.CI,
            timeout: 10000
        }
    })
});
