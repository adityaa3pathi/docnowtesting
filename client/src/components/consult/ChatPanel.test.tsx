// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChatApi, ChatMessage, ChatThread } from '@/lib/consult/chat';
import { ChatPanel } from './ChatPanel';

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = host = null;
    vi.useRealTimers();
});

const msg = (seq: number, body: string, mine = false): ChatMessage => ({ id: `id-${seq}`, seq, from: mine ? 'PATIENT' : 'DOCTOR', name: mine ? 'Asha' : 'Dr Rao', mine, body, sentAt: '2026-11-24T10:00:00Z' });
const thread = (messages: ChatMessage[], open = true, hasMore = false): ChatThread => ({ open, maxChars: 1000, hasMore, messages });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

async function mount(api: ChatApi, live = true, hideWhenEmpty = false) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(<ChatPanel api={api} live={live} hideWhenEmpty={hideWhenEmpty} />));
    await flush();
}

function type(text: string) {
    const box = host!.querySelector('textarea')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    act(() => {
        setter.call(box, text);
        box.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

describe('ChatPanel', () => {
    it('shows the thread and polls with the last seq as cursor', async () => {
        vi.useFakeTimers();
        const read = vi.fn().mockResolvedValueOnce(thread([msg(1, 'Any cough?')])).mockResolvedValue(thread([msg(1, 'Any cough?'), msg(2, 'And fever?')]));
        await mount({ read, send: vi.fn() });
        expect(host!.textContent).toContain('Any cough?');
        await act(async () => { vi.advanceTimersByTime(3_000); });
        await flush();
        expect(read).toHaveBeenLastCalledWith(1);
        // The overlapping page brings seq 1 again; it shows once.
        expect(host!.textContent!.match(/Any cough\?/g)).toHaveLength(1);
        expect(host!.textContent).toContain('And fever?');
    });

    it('sends, and a failed send retries with the same client id', async () => {
        const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(msg(3, 'I have a fever', true));
        await mount({ read: vi.fn().mockResolvedValue(thread([])), send }, false);
        type('I have a fever');
        await act(async () => host!.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        await flush();
        expect(host!.textContent).toContain('Not sent.');
        const retry = [...host!.querySelectorAll('button')].find((b) => b.textContent === 'Try again')!;
        await act(async () => retry.click());
        await flush();
        expect(send).toHaveBeenCalledTimes(2);
        expect(send.mock.calls[0][1]).toBe(send.mock.calls[1][1]);
        expect(host!.textContent).toContain('I have a fever');
        expect(host!.textContent).not.toContain('Not sent.');
    });

    it('reads every page of a long thread, not just the first', async () => {
        const read = vi.fn()
            .mockResolvedValueOnce(thread([msg(1, 'first page')], false, true))
            .mockResolvedValueOnce(thread([msg(2, 'second page')], false, false));
        await mount({ read, send: vi.fn() }, false);
        await flush();
        expect(read.mock.calls.map((c) => c[0])).toEqual([0, 1]);
        expect(host!.textContent).toContain('second page');
    });

    it('stops polling once the server says the chat is closed, and on an expired link', async () => {
        vi.useFakeTimers();
        const read = vi.fn().mockResolvedValue(thread([msg(1, 'bye')], false));
        await mount({ read, send: vi.fn() });
        await act(async () => { vi.advanceTimersByTime(10_000); });
        expect(read).toHaveBeenCalledTimes(1);
        act(() => root!.unmount());
        const gone = vi.fn().mockRejectedValue({ response: { status: 410, data: { error: 'This consultation link has expired' } } });
        await mount({ read: gone, send: vi.fn() });
        await act(async () => { vi.advanceTimersByTime(10_000); });
        expect(gone).toHaveBeenCalledTimes(1);
    });

    it('is read-only when closed, and hidden when closed and empty', async () => {
        await mount({ read: vi.fn().mockResolvedValue(thread([msg(1, 'Take rest')], false)), send: vi.fn() }, false, true);
        expect(host!.querySelector('textarea')).toBeNull();
        expect(host!.textContent).toContain('This chat is closed');
        act(() => root!.unmount());
        await mount({ read: vi.fn().mockResolvedValue(thread([], false)), send: vi.fn() }, false, true);
        expect(host!.textContent).toBe('');
    });
});
