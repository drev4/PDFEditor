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
