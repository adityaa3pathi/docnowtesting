import { describe, expect, it, vi } from 'vitest';
import { consultCsrfGuard } from './consultCsrf';

function run(req: any) {
    const res: any = { statusCode: 200, body: undefined };
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.json = (b: unknown) => { res.body = b; return res; };
    const next = vi.fn();
    consultCsrfGuard(req, res, next);
    return { res, next };
}

describe('consultCsrfGuard', () => {
    it('lets safe methods through', () => {
        expect(run({ method: 'GET', cookies: { docnow_access: 'x' }, headers: {} }).next).toHaveBeenCalled();
    });
    it('lets bearer-only requests through', () => {
        expect(run({ method: 'POST', cookies: {}, headers: { authorization: 'Bearer t' } }).next).toHaveBeenCalled();
    });
    it('rejects a cookie request with no CSRF token, even with the mobile header', () => {
        const { res, next } = run({ method: 'POST', cookies: { docnow_access: 'x' }, headers: { 'x-client-type': 'mobile' } });
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
    });
    it('rejects a mismatched token and accepts a matching one', () => {
        const base = { method: 'PUT', cookies: { docnow_refresh: 'x', docnow_csrf: 'abc123' } };
        expect(run({ ...base, headers: { 'x-docnow-csrf': 'zzz999' } }).res.statusCode).toBe(403);
        expect(run({ ...base, headers: { 'x-docnow-csrf': 'abc123' } }).next).toHaveBeenCalled();
    });
});
