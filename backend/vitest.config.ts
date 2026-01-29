import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
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
            '.cache'
        ],
        include: [
            'tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}'
        ]
    },
});
