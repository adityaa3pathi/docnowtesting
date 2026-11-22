/**
 * POST /api/support/chat/stream: the support chat turn as server-sent events (Phase 5).
 *
 * Events: `start` {conversation_id} at once, `status` {stage} while the turn runs, then one `final`
 * (the same body as POST /api/support/chat) or `error`. Status events never carry answer text: the
 * reply arrives once, in `final`, after the AI's verifier has checked it.
 *
 * fetch, not axios: axios cannot read a response body as it streams in the browser.
 */
import { getAccessToken, getApiUrl } from '@/lib/api';

export type StreamStage = 'searching' | 'checking_bookings' | 'updating_booking' | 'drafting' | 'verifying';

/** What the customer sees while a stage runs. */
export const STAGE_TEXT: Record<StreamStage, string> = {
    searching: 'Searching our tests and policies…',
    checking_bookings: 'Checking your bookings…',
    updating_booking: 'Updating your booking…',
    drafting: 'Writing an answer…',
    verifying: 'Checking the answer against our records…',
};

/** The route can't stream here and no turn ran: send the message on the JSON route instead. */
export class StreamUnavailable extends Error {
    /** False when it may work next time (an expired login), true when this server has no stream route. */
    constructor(readonly permanent: boolean, message = 'Streaming unavailable') {
        super(message);
    }
}

/** The server answered with an HTTP error before the turn started; shaped like an axios error. */
export class StreamHttpError extends Error {
    readonly response: { status: number; data: unknown };
    constructor(status: number, data: unknown) {
        super(`Stream request failed with ${status}`);
        this.response = { status, data };
    }
}

/** The stream started (so the turn ran or is running) and then broke before the final event. */
export class StreamBroken extends Error {
    constructor(readonly conversationId: string | null) {
        super('The answer stream was interrupted');
    }
}

/** The server reported that the turn failed (as POST /chat would with a 500). */
export class StreamTurnFailed extends Error {
    readonly response: { status: number; data: unknown };
    constructor(detail: string) {
        super(detail);
        this.response = { status: 500, data: { detail } };
    }
}

export interface StreamFinal {
    conversation_id: string;
    message_id: string;
    content: string;
    sources?: unknown[];
    actions_taken?: { summary: string }[];
    verified?: boolean;
    was_abstained?: boolean;
    cards?: unknown;
    pending_action?: { tool: string | null; parameters: Record<string, unknown> } | null;
}

/** Statuses that mean "this server has no stream route": don't try again this session. */
const NO_ROUTE = new Set([404, 405, 501]);

function csrfToken(): string | undefined {
    if (typeof document === 'undefined') return undefined;
    return document.cookie.match(/docnow_csrf=([^;]+)/)?.[1];
}

/** Split an SSE buffer into complete events; returns them and the unfinished rest. */
export function parseEvents(buffer: string): { events: { event: string; data: unknown }[]; rest: string } {
    const blocks = buffer.replace(/\r\n/g, '\n').split('\n\n');
    const rest = blocks.pop() ?? '';
    const events: { event: string; data: unknown }[] = [];
    for (const block of blocks) {
        let event = 'message';
        const data: string[] = [];
        for (const line of block.split('\n')) {
            if (!line || line.startsWith(':')) continue; // keep-alive comments
            const colon = line.indexOf(':');
            const field = colon < 0 ? line : line.slice(0, colon);
            const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
            if (field === 'event') event = value;
            else if (field === 'data') data.push(value);
        }
        if (data.length) events.push({ event, data: JSON.parse(data.join('\n')) });
    }
    return { events, rest };
}

export async function streamChat(
    body: { message: string; conversation_id: string | null },
    onStage: (stage: StreamStage) => void,
): Promise<StreamFinal> {
    if (typeof fetch !== 'function' || typeof ReadableStream === 'undefined' || typeof TextDecoder === 'undefined') {
        throw new StreamUnavailable(true, 'This browser cannot read streams');
    }
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-Client-Type': 'web',
    };
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const csrf = csrfToken();
    if (csrf) headers['x-docnow-csrf'] = csrf;

    // A rejected fetch says nothing certain about whether the turn ran, so it is not a reason to resend.
    const res = await fetch(getApiUrl('/support/chat/stream'), {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        if (NO_ROUTE.has(res.status)) throw new StreamUnavailable(true, `No stream route (${res.status})`);
        if (res.status === 401) throw new StreamUnavailable(false, 'Login expired'); // the JSON route refreshes it
        const data = await res.json().catch(() => ({}));
        throw new StreamHttpError(res.status, data);
    }
    if (!(res.headers.get('content-type') || '').includes('text/event-stream') || !res.body) {
        throw new StreamUnavailable(true, 'Not an event stream');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let conversationId: string | null = body.conversation_id;
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parsed = parseEvents(buffer);
            buffer = parsed.rest;
            for (const { event, data } of parsed.events) {
                const d = data as Record<string, unknown>;
                if (event === 'start' && typeof d.conversation_id === 'string') conversationId = d.conversation_id;
                else if (event === 'status' && typeof d.stage === 'string') onStage(d.stage as StreamStage);
                else if (event === 'final') return data as StreamFinal;
                else if (event === 'error') throw new StreamTurnFailed(String(d.detail || 'Failed to send message.'));
            }
        }
    } catch (err) {
        if (err instanceof StreamTurnFailed) throw err;
        throw new StreamBroken(conversationId);
    } finally {
        reader.releaseLock();
    }
    throw new StreamBroken(conversationId);
}
