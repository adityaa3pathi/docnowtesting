import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        include: ['src/**/*.test.ts'],
        // Both run: the general one blanks lab/S3 keys, the consult one blanks LiveKit and Expo push.
        setupFiles: ['./src/test/env.ts', './src/modules/consultations/test/env.ts'],
        clearMocks: true,
        restoreMocks: true,
        // Database suites share one test database and reset it, so files must not run at the same time.
        fileParallelism: !process.env.TEST_DATABASE_URL,
    },
});
