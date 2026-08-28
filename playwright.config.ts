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
    // Two servers, not one. The frontend alone used to be the readiness signal,
    // so a backend that died at boot let Playwright start anyway and every test
    // failed as a UI bug with nothing in the log naming the cause. Waiting on
    // /health makes that a fast, obvious failure instead of a 20-minute one.
    webServer: [
        {
            command: 'npm run dev --workspace=backend',
            url: 'http://localhost:3000/health',
            reuseExistingServer: !process.env.CI,
            timeout: 120000,
            stdout: 'pipe',
            stderr: 'pipe',
            env: {
                // Every test registers its own user, and the register limiter
                // defaults to 5 per hour per IP. Without this a clean checkout
                // fails with 429s that look like application errors.
                RATE_LIMIT_LOGIN_MAX: '100000',
                RATE_LIMIT_REGISTER_MAX: '100000',
                RATE_LIMIT_RESPONSES_MAX: '100000',
            },
        },
        {
            command: 'npm run dev --workspace=frontend',
            url: 'http://localhost:5173',
            reuseExistingServer: !process.env.CI,
            timeout: 120000,
            stdout: 'pipe',
            stderr: 'pipe',
        },
    ],
});
