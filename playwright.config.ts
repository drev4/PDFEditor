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
            // Never adopt a server this config did not start. A dev backend
            // already on :3000 does not have the RATE_LIMIT_* overrides below,
            // so registration hits the real limiter and ~28 tests fail on a
            // `waitForURL` timeout that looks exactly like an application bug.
            // That happened three times in one session before it was diagnosed.
            // If the port is busy, failing to start is the honest outcome.
            reuseExistingServer: false,
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
                // Plan limits are ON here regardless of the developer's
                // `.env`. `app.ts` calls `dotenv.config()`, so a local
                // `DEV_PLAN_KEY=dev` would otherwise reach the suite and
                // quietly disable the thing under test. Pinned rather than
                // absent: dotenv does not overwrite a key that is already
                // present, and an absent key it would happily fill in.
                //
                // **`team`, not empty, since features/0015.** Seats are enforced
                // now and Free covers one person — the owner — so on the free
                // plan every invitation answers 402 and `team.spec.ts` could
                // never reach the flow it tests. Seats are *bought*, and billing
                // is deliberately off in this suite (no Stripe keys below), so
                // there is no way to buy any here: pinning the plan is what
                // gives these organizations room. `team` and not `dev` because
                // it is a real plan with real limits — this suite is not running
                // with limits switched off, it is running as a paying customer
                // with three seats.
                DEV_PLAN_KEY: 'team',
                // Same reasoning for Stripe: `dotenv.config()` would otherwise
                // hand this suite a developer's real keys. Empty means billing
                // is off, so `/api/billing/*` answers 503 and nothing in this
                // suite can reach Stripe (features/0013).
                STRIPE_SECRET_KEY: '',
                STRIPE_WEBHOOK_SECRET: '',
                STRIPE_PRICE_PRO: '',
                STRIPE_PRICE_TEAM: '',
            },
        },
        {
            command: 'npm run dev --workspace=frontend',
            url: 'http://localhost:5173',
            // The SPA carries no test-only configuration, so adopting a dev
            // server here is harmless — unlike the backend above.
            reuseExistingServer: !process.env.CI,
            timeout: 120000,
            stdout: 'pipe',
            stderr: 'pipe',
        },
    ],
});
