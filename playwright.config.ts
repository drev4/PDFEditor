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
                // The refresh endpoint is hit by every page load that has a
                // session, and by every expiry below.
                RATE_LIMIT_REFRESH_MAX: '100000',
                // Deliberately tiny. With a 15-minute token no E2E run would
                // ever cross an expiry, and the refresh-and-retry path — the
                // one that decides whether a short-lived token is invisible to
                // the user or a logout every fifteen minutes — would have no
                // coverage at all. At 3 seconds most tests cross at least one.
                JWT_ACCESS_TTL: '3s',
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
