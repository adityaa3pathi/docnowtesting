// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEvents } from '@/lib/supportStream';

const m = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), authed: true }));
vi.mock('@/lib/api', () => ({
    default: { get: m.get, post: m.post },
    getAccessToken: () => null,
    getApiUrl: (path: string) => `/api${path}`,
}));
vi.mock('@/contexts/AuthContext', () => ({
    useAuth: () => ({ isAuthenticated: m.authed, isInitialized: true }),
}));

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const STORAGE_KEY = 'docnow_support_conversation_id';
const DRAFT_LIKE = 'UNVERIFIED';
const final = (content: string, conversation = 'conv-1') =>
    `event: final\ndata: ${JSON.stringify({ conversation_id: conversation, message_id: 'm-1', content, verified: true })}\n\n`;

/** A fetch Response whose body yields `chunks` one by one; `gate` pauses before the chunk at that index. */
function sseResponse(chunks: string[], opts: { gateAt?: number; gate?: Promise<void>; breakAt?: number } = {}) {
    const enc = new TextEncoder();
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
        async pull(ctrl) {
            if (opts.gateAt === i && opts.gate) await opts.gate;
            if (opts.breakAt === i) return ctrl.error(new TypeError('network error'));
            if (i < chunks.length) ctrl.enqueue(enc.encode(chunks[i++]));
            else ctrl.close();
        },
    });
    return { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }), body, json: async () => ({}) };
}

function httpError(status: number, data: unknown) {
    return { ok: false, status, headers: new Headers({ 'content-type': 'application/json' }), body: null, json: async () => data };
}

type Hook = ReturnType<typeof import('./useSupportChat').useSupportChat>;
let seen: Hook | null = null;

/** A fresh hook module each test: "the server has no stream route" is remembered per page load. */
async function mount() {
    vi.resetModules();
    const { useSupportChat } = await import('./useSupportChat');
    function Probe() {
        seen = useSupportChat();
        return null;
    }
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Probe />));
    await act(async () => {});
    return root;
}

const fetchMock = vi.fn();
beforeEach(() => {
    localStorage.clear();
    m.authed = true;
    m.get.mockReset();
    m.post.mockReset();
    fetchMock.mockReset();
    m.get.mockResolvedValue({ data: { messages: [] } });
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('useSupportChat streaming', () => {
    it('shows what the AI is doing, then only the verified reply', async () => {
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        fetchMock.mockResolvedValue(sseResponse([
            'event: start\ndata: {"conversation_id": "conv-1"}\n\n',
            'event: status\ndata: {"stage": "searching"}\n\n: ping\n\n',
            'event: status\ndata: {"stage": "drafting"}\n\nevent: status\ndata: {"stage": "verifying"}\n\n',
            final('Fasting is 12 hours.'),
        ], { gateAt: 3, gate }));

        const root = await mount();
        let sending!: Promise<void>;
        await act(async () => { sending = seen!.sendMessage('Do I need to fast?'); });
        await vi.waitFor(() => expect(seen!.status).toBe('Checking the answer against our records…'));
        expect(seen!.messages.at(-1)!.role).toBe('user'); // nothing of the answer is shown yet
        expect(seen!.isLoading).toBe(true);

        await act(async () => { release(); await sending; });
        expect(seen!.messages.at(-1)).toMatchObject({ role: 'assistant', content: 'Fasting is 12 hours.', verified: true });
        expect(seen!.status).toBeNull();
        expect(seen!.conversationId).toBe('conv-1');
        expect(m.post).not.toHaveBeenCalled();
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/support/chat/stream');
        expect(JSON.parse(init.body)).toEqual({ message: 'Do I need to fast?', conversation_id: null });
        act(() => root.unmount());
    });

    it('uses the JSON route when the server has no stream route, and stops trying', async () => {
        fetchMock.mockResolvedValue(httpError(404, { detail: 'Not Found' }));
        m.post.mockResolvedValue({ data: { conversation_id: 'conv-1', message_id: 'm1', content: 'hi there' } });

        const root = await mount();
        await act(async () => seen!.sendMessage('hello'));
        await act(async () => seen!.sendMessage('again'));

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(m.post).toHaveBeenCalledTimes(2);
        expect(seen!.messages.at(-1)!.content).toBe('hi there');
        expect(seen!.error).toBeNull();
        act(() => root.unmount());
    });

    it('lets the JSON route refresh an expired login, and streams again next time', async () => {
        fetchMock.mockResolvedValueOnce(httpError(401, { detail: 'Token expired' }));
        m.post.mockResolvedValue({ data: { conversation_id: 'conv-1', message_id: 'm1', content: 'from json' } });
        const root = await mount();
        await act(async () => seen!.sendMessage('hello'));
        expect(m.post).toHaveBeenCalledTimes(1);

        fetchMock.mockResolvedValueOnce(sseResponse([final('streamed')]));
        await act(async () => seen!.sendMessage('again'));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(seen!.messages.at(-1)!.content).toBe('streamed');
        act(() => root.unmount());
    });

    it('shows the turn-cap error from the stream route without resending', async () => {
        localStorage.setItem(STORAGE_KEY, 'conv-1');
        const detail = 'Conversation has reached the maximum number of turns. Please start a new conversation.';
        fetchMock.mockResolvedValue(httpError(400, { detail }));

        const root = await mount();
        await act(async () => seen!.sendMessage('one more'));

        expect(seen!.error).toBe(detail);
        expect(seen!.conversationId).toBeNull();
        expect(m.post).not.toHaveBeenCalled();
        act(() => root.unmount());
    });

    it('never resends a signed-in turn after the stream breaks; it reloads what the server stored', async () => {
        localStorage.setItem(STORAGE_KEY, 'conv-1');
        fetchMock.mockResolvedValue(sseResponse([
            'event: start\ndata: {"conversation_id": "conv-1"}\n\n',
            'event: status\ndata: {"stage": "updating_booking"}\n\n',
        ], { breakAt: 2 }));
        m.get.mockResolvedValue({ data: { messages: [
            { id: 'u1', role: 'user', content: 'yes', created_at: '2026-11-22T10:00:00Z' },
            { id: 'a1', role: 'assistant', content: 'Your booking is cancelled.', created_at: '2026-11-22T10:00:05Z' },
        ] } });

        const root = await mount();
        m.get.mockClear();
        await act(async () => seen!.sendMessage('yes'));

        expect(m.post).not.toHaveBeenCalled(); // a resent "yes" could repeat the booking change
        expect(m.get).toHaveBeenCalledWith('/support/history?conversation_id=conv-1');
        expect(seen!.messages.at(-1)!.content).toBe('Your booking is cancelled.');
        act(() => root.unmount());
    }, 10000);

    it('resends a signed-out turn on the JSON route after the stream breaks', async () => {
        m.authed = false;
        fetchMock.mockResolvedValue(sseResponse([
            'event: start\ndata: {"conversation_id": "ephemeral"}\n\n',
        ], { breakAt: 1 }));
        m.post.mockResolvedValue({ data: { conversation_id: 'ephemeral', message_id: 'ephemeral', content: 'CBC is ₹279.' } });

        const root = await mount();
        await act(async () => seen!.sendMessage('CBC price?'));

        expect(m.post).toHaveBeenCalledWith('/support/chat', { message: 'CBC price?', conversation_id: null });
        expect(seen!.messages.at(-1)!.content).toBe('CBC is ₹279.');
        act(() => root.unmount());
    });

    it('shows the server error event and does not resend', async () => {
        fetchMock.mockResolvedValue(sseResponse([
            'event: start\ndata: {"conversation_id": "conv-1"}\n\n',
            'event: error\ndata: {"detail": "An error occurred processing your request"}\n\n',
        ]));
        const root = await mount();
        await act(async () => seen!.sendMessage('hi'));
        expect(seen!.error).toBe('An error occurred processing your request');
        expect(m.post).not.toHaveBeenCalled();
        act(() => root.unmount());
    });
});

describe('parseEvents', () => {
    it('keeps an event split across chunks until it is complete, and skips keep-alives', () => {
        const first = parseEvents('event: status\ndata: {"stage": "searching"}\n\n: ping\n\nevent: fin');
        expect(first.events).toEqual([{ event: 'status', data: { stage: 'searching' } }]);
        const second = parseEvents(first.rest + 'al\ndata: {"content": "ok"}\r\n\r\n');
        expect(second.events).toEqual([{ event: 'final', data: { content: 'ok' } }]);
        expect(second.rest).toBe('');
        expect(JSON.stringify(first)).not.toContain(DRAFT_LIKE);
    });
});
