import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    // Node by default; component tests opt into a DOM with `// @vitest-environment jsdom`.
    test: { environment: 'node', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
    resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
});
