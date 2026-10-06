import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        include: ['src/**/*.test.ts'],
        clearMocks: true,
        restoreMocks: true,
        // Database suites share one test database and reset it, so files must not run at the same time.
        fileParallelism: !process.env.TEST_DATABASE_URL,
    },
});
