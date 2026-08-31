import { defineConfig } from 'vitest/config';

// Integration tests run against a REAL PostgreSQL database.
// Cascades, constraints and transaction rollbacks cannot be expressed with a
// mocked Prisma client, so these specs never mock `src/services/db`.
export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        env: {
            JWT_SECRET: 'test-jwt-secret',
            // Vitest mirrors Vite's `import.meta.env` into `process.env`, and
            // Vite always defines BASE_URL — as `/`, the public base path. So
            // `process.env.BASE_URL || 'http://localhost:3000'` silently
            // resolves to `/` under test and every PDF URL comes out relative.
            // Pin it to what a deploy sets, or the specs test a URL shape
            // production never produces.
            BASE_URL: 'http://localhost:3000',
            // The suites drive these endpoints repeatedly; the rate-limit spec
            // tightens them per test through the same process.env path.
            RATE_LIMIT_LOGIN_MAX: '1000',
            RATE_LIMIT_REGISTER_MAX: '1000',
            RATE_LIMIT_RESPONSES_MAX: '1000',
            RATE_LIMIT_REFRESH_MAX: '1000',
            RATE_LIMIT_INVITATION_MAX: '1000',
            // Plan limits are ON in the suites regardless of the developer's
            // `.env`. `src/app.ts` calls `dotenv.config()` and every spec
            // imports it, so a local `DEV_PLAN_KEY=dev` would otherwise reach
            // these tests and disable the behaviour they assert — which it did,
            // and four of them failed before this line existed. Empty rather
            // than absent: dotenv does not overwrite a key already present.
            DEV_PLAN_KEY: '',
            // Stripe credentials are pinned for the same reason `DEV_PLAN_KEY`
            // is: `src/app.ts` calls `dotenv.config()`, so a developer's real
            // `.env` reaches every suite. Without these three lines a live
            // `STRIPE_SECRET_KEY` would be the one the tests construct a client
            // with. They are deliberately not valid keys — nothing here makes a
            // network call. Signature verification and
            // `generateTestHeaderString` are local HMAC over
            // `STRIPE_WEBHOOK_SECRET`, and `STRIPE_PRICE_PRO` has to match the
            // fixture in `tests/fixtures/stripe-events.ts` or every subscription
            // resolves to free.
            STRIPE_SECRET_KEY: 'sk_test_0013_suite',
            STRIPE_WEBHOOK_SECRET: 'whsec_test_0013_suite',
            STRIPE_PRICE_PRO: 'price_test_pro_0013',
            DATABASE_URL: process.env.DATABASE_URL
                ?? 'postgresql://postgres:postgres@localhost:5432/vuepdf_test?schema=public'
        },
        setupFiles: ['./tests/integration/setup.ts'],
        include: ['tests/integration/**/*.{test,spec}.ts'],
        // The suites share one database; run them one file at a time.
        fileParallelism: false,
        testTimeout: 30000
    },
});
