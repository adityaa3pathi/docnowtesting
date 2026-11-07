import { describe, expect, it } from 'vitest';
import { trustProxySetting } from './trustProxy';

describe('trustProxySetting', () => {
    it('defaults to the local Nginx and parses overrides', () => {
        expect(trustProxySetting(undefined)).toBe('loopback');
        expect(trustProxySetting(' ')).toBe('loopback');
        expect(trustProxySetting('2')).toBe(2);
        expect(trustProxySetting('false')).toBe(false);
        expect(trustProxySetting('loopback, 173.245.48.0/20')).toBe('loopback, 173.245.48.0/20');
    });
});
