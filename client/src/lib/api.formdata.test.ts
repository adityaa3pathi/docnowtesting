// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import api from './api';

/** Captures what axios would put on the wire, after its own request transforms. */
function capture() {
    const seen: InternalAxiosRequestConfig[] = [];
    const adapter: AxiosAdapter = async (config) => {
        seen.push(config);
        return { data: {}, status: 200, statusText: '', headers: {}, config };
    };
    api.defaults.adapter = adapter;
    return seen;
}
const original = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = original; });

describe('request bodies', () => {
    it('sends FormData as multipart (the file included), not turned into JSON by the default content type', async () => {
        const seen = capture();
        const form = new FormData();
        form.append('data', JSON.stringify({ a: 1 }));
        form.append('photo', new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'photo.jpg');
        await api.post('/admin/consult/doctors', form);

        expect(seen[0].data).toBeInstanceOf(FormData);
        expect((seen[0].data as FormData).get('photo')).toBeInstanceOf(Blob);
        expect(String(seen[0].headers.getContentType() ?? '')).not.toContain('application/json');
    });

    it('still sends plain objects as JSON', async () => {
        const seen = capture();
        await api.post('/auth/login/password', { mobile: '9876543210', password: 'x' });
        expect(seen[0].data).toBe('{"mobile":"9876543210","password":"x"}');
        expect(String(seen[0].headers.getContentType())).toContain('application/json');
    });
});
