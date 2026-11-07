// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: { get: m.get, post: m.post } }));
vi.mock('@/contexts/AuthContext', () => ({
    useAuth: () => ({ isAuthenticated: true, isInitialized: true }),
}));
const { useSupportChat } = await import('./useSupportChat');

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const STORAGE_KEY = 'docnow_support_conversation_id';

let seen: ReturnType<typeof useSupportChat> | null = null;
function Probe() {
    seen = useSupportChat();
    return null;
}

function mount() {
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Probe />));
    return root;
}

function axiosError(status: number, data: unknown) {
    return Object.assign(new Error('request failed'), { response: { status, data } });
}

beforeEach(() => {
    localStorage.clear();
    m.get.mockReset();
    m.post.mockReset();
    m.get.mockResolvedValue({ data: { messages: [] } });
});

describe('useSupportChat', () => {
    it('shows the server message when the conversation hits the turn cap', async () => {
        localStorage.setItem(STORAGE_KEY, 'conv-1');
        const detail = 'Conversation has reached the maximum number of turns. Please start a new conversation.';
        m.post.mockRejectedValue(axiosError(400, { detail }));

        const root = mount();
        await act(async () => {});
        await act(async () => seen!.sendMessage('one more'));

        expect(seen!.error).toBe(detail);
        act(() => root.unmount());
    });

    it('drops the capped conversation id so the next message starts a new one', async () => {
        localStorage.setItem(STORAGE_KEY, 'conv-1');
        m.post.mockRejectedValue(axiosError(400, { detail: 'cap reached' }));

        const root = mount();
        await act(async () => {});
        await act(async () => seen!.sendMessage('one more'));

        expect(seen!.conversationId).toBeNull();
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

        m.post.mockResolvedValue({ data: { conversation_id: 'conv-2', message_id: 'm1', content: 'hi' } });
        await act(async () => seen!.sendMessage('hello'));

        expect(m.post).toHaveBeenLastCalledWith('/support/chat', { message: 'hello', conversation_id: null });
        expect(seen!.conversationId).toBe('conv-2');
        act(() => root.unmount());
    });

    it('shows an Express error field too', async () => {
        m.post.mockRejectedValue(axiosError(429, { error: 'Too many requests. Try again later.' }));

        const root = mount();
        await act(async () => {});
        await act(async () => seen!.sendMessage('hi'));

        expect(seen!.error).toBe('Too many requests. Try again later.');
        act(() => root.unmount());
    });

    it('falls back to a generic message when the server sends none', async () => {
        m.post.mockRejectedValue(axiosError(500, {}));

        const root = mount();
        await act(async () => {});
        await act(async () => seen!.sendMessage('hi'));

        expect(seen!.error).toBe('Failed to send message.');
        act(() => root.unmount());
    });
});
