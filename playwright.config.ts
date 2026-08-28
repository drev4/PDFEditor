import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',
    use: {
        baseURL: 'http://localhost:5173',
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
        env: {
            // Every test registers its own user, and the register limiter
            // defaults to 5 per hour per IP. Without this a clean checkout fails
            // with 429s that look like application errors. Set here rather than
            // documented, so `npm run test:e2e` works with no local setup.
            RATE_LIMIT_LOGIN_MAX: '100000',
            RATE_LIMIT_REGISTER_MAX: '100000',
            RATE_LIMIT_RESPONSES_MAX: '100000',
        },
    },
});
