import { defineConfig } from 'vitest/config';

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
            // The job queue is OFF in every suite, whatever the developer's
            // `.env` says. Same reason as `DEV_PLAN_KEY` above: `src/app.ts`
            // calls `dotenv.config()`, so a local `REDIS_URL` would reach these
            // specs and move the PDF embed onto a worker that is not running -
            // every embed assertion would then be measuring a document nothing
            // ever wrote. Empty rather than absent: dotenv does not overwrite a
            // key that is already present. The queued path has its own spec,
            // which sets this deliberately (features/0017).
            REDIS_URL: '',
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
            // Team is per-seat (features/0015). Set here for the same reason as
            // the Pro price: without it a Team subscription resolves to free and
            // every seat assertion below would be measuring the free plan.
            STRIPE_PRICE_TEAM: 'price_test_team_0015',
            // Registration is OPEN in every suite, whatever the developer's
            // `.env` says (features/0033). Same reason as `DEV_PLAN_KEY` above:
            // `src/app.ts` calls `dotenv.config()`, so a developer running the
            // beta configuration locally would close registration for the four
            // register tests in `tests/auth.spec.ts` and the ones in
            // `tests/rate-limit.spec.ts` that drive the limiter through it. The
            // closed path has its own tests, which set this per case and delete
            // it afterwards.
            REGISTRATION_MODE: 'open',
        },
        setupFiles: ['./tests/setup.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html', 'lcov'],
            exclude: [
                'node_modules/',
                'tests/',
                '**/*.spec.ts',
                '**/*.test.ts',
                'dist/',
                'prisma/',
                '*.config.ts',
                'src/index.ts'
            ],
            include: [
                'src/**/*.ts'
            ],
            all: true,
            lines: 70,
            functions: 70,
            branches: 70,
            statements: 70
        },
        exclude: [
            'node_modules',
            'dist',
            '.idea',
            '.git',
            '.cache',
            // Database-backed specs; run with `npm run test:integration`.
            'tests/integration/**'
        ],
        include: [
            'tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}'
        ]
    },
});
