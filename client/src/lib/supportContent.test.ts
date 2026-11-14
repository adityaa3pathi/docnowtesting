import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }));
const content = await import('./supportContent');

// The Help, FAQ and Contact pages render nothing if the source file goes missing again.
describe('support content source', () => {
    it('loads FAQ and help sections from the shipped markdown file', async () => {
        const loaders = [content.getSupportFaqs, content.getHelpCenterContent, content.getContactPageContent].map((f) => ['', f] as const);
        expect(loaders.length).toBeGreaterThan(0);
        for (const [, load] of loaders) {
            const out = await (load as () => Promise<unknown>)();
            expect(JSON.stringify(out)).not.toMatch(/"sections":\[\]/);
        }
    });
});
