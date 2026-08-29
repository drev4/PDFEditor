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
            RATE_LIMIT_INVITATION_MAX: '1000'
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
