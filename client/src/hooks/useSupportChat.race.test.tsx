// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), auth: { isAuthenticated: true, isInitialized: false } }));
vi.mock('@/lib/api', () => ({ default: { get: m.get, post: m.post } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => m.auth }));
const { useSupportChat } = await import('./useSupportChat');

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let seen: ReturnType<typeof useSupportChat> | null = null;
function Probe() {
    seen = useSupportChat();
    return null;
}

it('keeps the customer message when the login check finishes mid-reply', async () => {
    let reply: (v: unknown) => void = () => {};
    m.post.mockImplementation(() => new Promise((r) => { reply = r; }));
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Probe />));

    await act(async () => { void seen!.sendMessage('I feel tired'); });
    m.auth = { isAuthenticated: true, isInitialized: true };
    act(() => root.render(<Probe />));
    await act(async () => { reply({ data: { conversation_id: 'c1', message_id: 'a1', content: 'Tests often checked…', cards: [] } }); });

    expect(seen!.messages.map((x) => [x.role, x.content])).toEqual([
        ['assistant', expect.any(String)],
        ['user', 'I feel tired'],
        ['assistant', 'Tests often checked…'],
    ]);
    expect(m.get).not.toHaveBeenCalled();
});
