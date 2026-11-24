'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, MessageSquare, Send } from 'lucide-react';
import { Button } from '@/components/ui';
import { errorMessage, errorStatus } from '@/lib/consult/api';
import { chatCopy, lastSeq, mergeMessages, newClientId, type ChatApi, type ChatLanguage, type ChatMessage } from '@/lib/consult/chat';
import { formatIstTime } from '@/lib/consult/time';
import { cn } from '@/lib/utils';

export const CHAT_POLL_MS = 3_000;
const MAX_PAGES_PER_READ = 5;

interface Pending { clientId: string; body: string; failed: boolean }

interface Props {
    api: ChatApi;
    /** In the call: poll for new messages while the chat is open. Otherwise load once (the record). */
    live: boolean;
    language?: ChatLanguage;
    /** Larger text for the family web room. */
    senior?: boolean;
    /** Outside the call, show nothing when there were no messages. */
    hideWhenEmpty?: boolean;
    className?: string;
}

/** The call's text chat. Read-only once the server says it is closed. */
export function ChatPanel({ api, live, language = 'en', senior = false, hideWhenEmpty = false, className }: Props) {
    const copy = chatCopy(language);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    // null until the first read; false once the server says the chat is closed (polling then stops).
    const [open, setOpen] = useState<boolean | null>(null);
    const [maxChars, setMaxChars] = useState(1000);
    const [loaded, setLoaded] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [draft, setDraft] = useState('');
    const [pending, setPending] = useState<Pending[]>([]);
    const cursor = useRef(0);
    const listRef = useRef<HTMLOListElement>(null);
    const atBottom = useRef(true);

    const poll = useCallback(async () => {
        try {
            // A long thread comes in pages of 200: keep reading while the server says there is more.
            for (let i = 0; i < MAX_PAGES_PER_READ; i++) {
                const page = await api.read(cursor.current);
                cursor.current = Math.max(cursor.current, lastSeq(page.messages));
                setMessages((shown) => mergeMessages(shown, page.messages));
                setOpen(page.open);
                setMaxChars(page.maxChars);
                setLoadError(null);
                if (!page.hasMore) break;
            }
        } catch (e) {
            // Gone (the family link expired) or not ours: stop asking.
            const status = errorStatus(e);
            if (status === 404 || status === 410) setOpen(false);
            setLoadError(errorMessage(e, 'Could not load the chat.'));
        } finally {
            setLoaded(true);
        }
    }, [api]);

    // First read, and again when the page says the call started or ended.
    useEffect(() => {
        void poll();
    }, [poll, live]);

    useEffect(() => {
        if (!live || open === false) return;
        // Hidden tabs skip a beat; coming back reads at once.
        const t = setInterval(() => { if (!document.hidden) void poll(); }, CHAT_POLL_MS);
        const onVisible = () => { if (!document.hidden) void poll(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            clearInterval(t);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [live, open, poll]);

    // Follow new messages only when the reader is already at the bottom.
    useEffect(() => {
        const el = listRef.current;
        if (el && atBottom.current) el.scrollTop = el.scrollHeight;
    }, [messages, pending]);

    async function deliver(item: Pending) {
        setPending((p) => p.map((x) => (x.clientId === item.clientId ? { ...x, failed: false } : x)));
        try {
            const saved = await api.send(item.body, item.clientId);
            setMessages((shown) => mergeMessages(shown, [saved]));
            setPending((p) => p.filter((x) => x.clientId !== item.clientId));
        } catch (e) {
            setPending((p) => p.map((x) => (x.clientId === item.clientId ? { ...x, failed: true } : x)));
            setLoadError(errorMessage(e));
            // A 409 means the chat closed: re-read so the composer goes away.
            void poll();
        }
    }

    function submit() {
        const body = draft.trim();
        if (!body || body.length > maxChars) return;
        const item = { clientId: newClientId(), body, failed: false };
        setPending((p) => [...p, item]);
        setDraft('');
        atBottom.current = true;
        void deliver(item);
    }

    if (!loaded) {
        return live ? (
            <div role="status" className={cn('flex items-center gap-2 rounded-xl border border-border bg-surface p-4 text-sm text-ink-muted', className)}>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {copy.title}
            </div>
        ) : null;
    }
    if (hideWhenEmpty && messages.length === 0 && pending.length === 0 && !open) return null;

    const left = maxChars - draft.trim().length;
    const text = senior ? 'text-lg' : 'text-sm';
    return (
        <section aria-label={copy.title} className={cn('space-y-2 rounded-xl border border-border bg-surface p-3', className)}>
            <h2 className={cn('flex items-center gap-2 font-semibold text-ink', senior ? 'text-lg' : 'text-sm')}>
                <MessageSquare className="h-4 w-4 text-primary" aria-hidden /> {copy.title}
            </h2>
            <ol
                ref={listRef}
                aria-live="polite"
                onScroll={(e) => {
                    const el = e.currentTarget;
                    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
                }}
                className="max-h-64 space-y-2 overflow-y-auto overscroll-contain pr-1"
            >
                {messages.length === 0 && pending.length === 0 && <li className={cn('text-ink-muted', text)}>{copy.empty}</li>}
                {messages.map((m) => (
                    <li key={m.id} className={cn('flex flex-col', m.mine ? 'items-end' : 'items-start')}>
                        <span className="text-xs text-ink-muted">{m.mine ? copy.you : m.name} · {formatIstTime(m.sentAt)}</span>
                        <p className={cn('max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2', text,
                            m.mine ? 'bg-primary text-primary-foreground' : 'bg-surface-muted text-ink')}>
                            {m.body}
                        </p>
                    </li>
                ))}
                {pending.map((p) => (
                    <li key={p.clientId} className="flex flex-col items-end">
                        <p className={cn('max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-primary/60 px-3 py-2 text-primary-foreground', text)}>{p.body}</p>
                        {p.failed ? (
                            <span className="text-xs text-danger-ink">
                                {copy.failed}{' '}
                                {open && <button type="button" className="font-semibold underline" onClick={() => void deliver(p)}>{copy.retry}</button>}
                            </span>
                        ) : (
                            <span className="text-xs text-ink-muted">{copy.sending}</span>
                        )}
                    </li>
                ))}
            </ol>
            {loadError && <p role="alert" className="text-xs text-danger-ink">{loadError}</p>}
            {open ? (
                <form
                    className="space-y-1"
                    onSubmit={(e) => {
                        e.preventDefault();
                        submit();
                    }}
                >
                    <div className="flex items-end gap-2">
                        <textarea
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                                // Enter sends; Shift+Enter adds a line. Phones keep Enter as a new line via the button.
                                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                                    e.preventDefault();
                                    submit();
                                }
                            }}
                            rows={senior ? 2 : 1}
                            maxLength={maxChars + 50}
                            aria-label={copy.placeholder}
                            placeholder={copy.placeholder}
                            className={cn('min-h-11 min-w-0 flex-1 resize-none rounded-xl border border-border bg-surface px-3 py-2 text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', senior ? 'text-lg' : 'text-base sm:text-sm')}
                        />
                        <Button type="submit" size={senior ? 'lg' : 'md'} disabled={!draft.trim() || left < 0} aria-label={copy.send}>
                            <Send className="h-4 w-4" aria-hidden /><span className="ml-1.5 hidden sm:inline">{copy.send}</span>
                        </Button>
                    </div>
                    {left < 100 && <p className={cn('text-xs', left < 0 ? 'text-danger-ink' : 'text-ink-muted')}>{copy.left(Math.max(left, 0))}</p>}
                </form>
            ) : open === false && (
                <p className={cn('text-ink-muted', senior ? 'text-base' : 'text-xs')}>{copy.closed}</p>
            )}
        </section>
    );
}
