import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { webCss } from '../../../design-tokens/build.mjs';

describe('design tokens', () => {
    it('tokens.css matches design-tokens/tokens.json (run node design-tokens/build.mjs)', () => {
        expect(readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')).toBe(webCss());
    });
});
