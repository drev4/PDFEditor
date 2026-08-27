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
