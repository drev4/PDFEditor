// Global test setup
import { beforeAll, afterAll, vi } from 'vitest';

beforeAll(() => {
    // Setup code (e.g., waiting for DB connection)
});

afterAll(() => {
    // Teardown code (e.g., closing DB connection)
    vi.clearAllMocks();
});
