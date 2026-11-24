/** In-call chat: the shared shapes, the merge rule for polled pages, and the Hindi/English copy. */

export type ChatRole = 'DOCTOR' | 'PATIENT' | 'CARETAKER';

export interface ChatMessage {
    id: string;
    seq: number;
    from: ChatRole;
    name: string;
    mine: boolean;
    body: string;
    sentAt: string;
}

export interface ChatThread {
    /** False once the call is over: the thread is then read-only. */
    open: boolean;
    maxChars: number;
    /** The page was full: read again from the last seq for the rest. */
    hasMore: boolean;
    messages: ChatMessage[];
}

/** One side's way to reach its chat routes (patient, doctor or the family web link). */
export interface ChatApi {
    read: (after: number) => Promise<ChatThread>;
    send: (body: string, clientId: string) => Promise<ChatMessage>;
}

/**
 * Adds a polled page to what is shown. Reads overlap the last few seconds on purpose (a late
 * commit can carry a lower seq), so ids already present are skipped; the result is in seq order.
 */
export function mergeMessages(shown: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
    if (incoming.length === 0) return shown;
    const seen = new Set(shown.map((m) => m.id));
    const fresh = incoming.filter((m) => !seen.has(m.id));
    if (fresh.length === 0) return shown;
    return [...shown, ...fresh].sort((a, b) => a.seq - b.seq);
}

/** The highest seq shown: the next read asks for messages after it. */
export const lastSeq = (messages: ChatMessage[]) => messages.reduce((max, m) => Math.max(max, m.seq), 0);

export function newClientId(): string {
    const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `c_${id.replace(/[^A-Za-z0-9_-]/g, '')}`.slice(0, 64);
}

export type ChatLanguage = 'en' | 'hi';

const COPY = {
    en: {
        title: 'Chat',
        empty: 'No messages yet. You can type here during the call.',
        placeholder: 'Type a message',
        send: 'Send',
        sending: 'Sending…',
        failed: 'Not sent.',
        retry: 'Try again',
        closed: 'This chat is closed. You can still read it.',
        you: 'You',
        left: (n: number) => `${n} characters left`,
    },
    hi: {
        title: 'चैट',
        empty: 'अभी कोई संदेश नहीं। कॉल के दौरान आप यहाँ लिख सकते हैं।',
        placeholder: 'संदेश लिखें',
        send: 'भेजें',
        sending: 'भेजा जा रहा है…',
        failed: 'नहीं भेजा गया।',
        retry: 'फिर से भेजें',
        closed: 'यह चैट बंद हो गई है। आप इसे पढ़ सकते हैं।',
        you: 'आप',
        left: (n: number) => `${n} अक्षर बाकी`,
    },
} as const;

export type ChatCopy = (typeof COPY)[ChatLanguage];
export const chatCopy = (language: ChatLanguage = 'en'): ChatCopy => COPY[language];
