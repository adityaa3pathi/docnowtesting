import { useState, useEffect, useCallback, useRef } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

export interface ChatSource {
    title: string;
    url?: string;
    type?: string;
}

/** A catalog test the bot found; built by the server from catalog rows, never from the reply text. */
export interface ChatProductCard {
    code: string;
    name: string;
    type: string;
    price: number;
    mrp?: number | null;
    sampleType?: string | null;
    reportTime?: string | null;
}

export function toProductCards(raw: unknown): ChatProductCard[] {
    if (!Array.isArray(raw)) return [];
    return (raw as Record<string, unknown>[])
        .filter((c) => c && typeof c.code === 'string' && typeof c.name === 'string' && typeof c.price === 'number')
        .map((c) => ({
            code: c.code as string,
            name: c.name as string,
            type: typeof c.type === 'string' ? c.type : 'TEST',
            price: c.price as number,
            mrp: typeof c.mrp === 'number' ? c.mrp : null,
            sampleType: typeof c.sample_type === 'string' ? c.sample_type : null,
            reportTime: typeof c.report_time === 'string' ? c.report_time : null,
        }));
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    sources?: ChatSource[];
    actions?: string[];
    cards?: ChatProductCard[];
    verified?: boolean;
    wasAbstained?: boolean;
    feedbackScore?: number;
    createdAt: string;
}

const DEFAULT_WELCOME_MESSAGE: ChatMessage = {
    id: 'welcome',
    role: 'assistant',
    content: "Hello! I am DocNow's AI support assistant. How can I help you today?",
    createdAt: new Date().toISOString(),
};

/** FastAPI sends `detail`, Express sends `error`; showing it beats a generic failure line. */
function serverErrorMessage(err: any): string | null {
    const data = err?.response?.data;
    const message = data?.detail ?? data?.error ?? data?.message;
    return typeof message === 'string' && message.trim() ? message : null;
}

export function useSupportChat() {
    const { isAuthenticated, isInitialized } = useAuth();
    const [messages, setMessages] = useState<ChatMessage[]>([DEFAULT_WELCOME_MESSAGE]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [conversationId, setConversationId] = useState<string | null>(null);

    // Auto-scroll trigger
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = useCallback(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages, scrollToBottom]);

    const resetChat = useCallback(() => {
        localStorage.removeItem('docnow_support_conversation_id');
        setConversationId(null);
        setError(null);
        setMessages([DEFAULT_WELCOME_MESSAGE]);
    }, []);

    const loadHistory = async (id: string) => {
        if (!id || id === 'ephemeral') return;
        setIsLoading(true);
        setError(null);
        try {
            const res = await api.get(`/support/history?conversation_id=${id}`);
            if (res.data && Array.isArray(res.data.messages) && res.data.messages.length > 0) {
                const formatted: ChatMessage[] = res.data.messages.map((m: any) => ({
                    id: m.id || Date.now().toString(),
                    role: m.role || 'assistant',
                    content: m.content || '',
                    sources: m.sources?.map((s: any) => ({
                        title: s.title || '',
                        url: s.url,
                        type: s.source_type || s.type,
                    })) || [],
                    actions: m.actions || [],
                    cards: toProductCards(m.cards),
                    verified: m.verified ?? false,
                    wasAbstained: m.was_abstained ?? m.wasAbstained ?? false,
                    feedbackScore: m.feedback_score ?? m.feedbackScore,
                    createdAt: m.created_at ?? m.createdAt ?? new Date().toISOString(),
                }));
                setMessages(formatted);
            } else {
                setMessages([DEFAULT_WELCOME_MESSAGE]);
            }
        } catch (err: any) {
            console.warn('Failed to load chat history:', err);
            const status = err?.response?.status;
            // If the conversation is gone (404), unauthenticated (401), or invalid:
            if (status === 404 || status === 401) {
                localStorage.removeItem('docnow_support_conversation_id');
                setConversationId(null);
                setMessages([DEFAULT_WELCOME_MESSAGE]);
                setError(null); // Clean fallback to fresh chat session without alarming error
            } else {
                // Network glitch or server wake-up: keep welcome message and show notice
                setMessages((prev) => prev.length > 0 ? prev : [DEFAULT_WELCOME_MESSAGE]);
                setError('Failed to load chat history.');
            }
        } finally {
            setIsLoading(false);
        }
    };

    // Load from local storage once auth state is initialized
    useEffect(() => {
        if (!isInitialized) return;

        if (!isAuthenticated) {
            localStorage.removeItem('docnow_support_conversation_id');
            setConversationId(null);
            setMessages([DEFAULT_WELCOME_MESSAGE]);
            setError(null);
            return;
        }

        const storedId = localStorage.getItem('docnow_support_conversation_id');
        if (storedId && storedId !== 'ephemeral') {
            setConversationId(storedId);
            loadHistory(storedId);
        } else {
            setMessages([DEFAULT_WELCOME_MESSAGE]);
        }
    }, [isInitialized, isAuthenticated]);

    const sendMessage = async (text: string) => {
        if (!text.trim()) return;

        const newMessage: ChatMessage = {
            id: Date.now().toString(),
            role: 'user',
            content: text,
            createdAt: new Date().toISOString(),
        };

        setMessages((prev) => [...prev, newMessage]);
        setIsLoading(true);
        setError(null);

        try {
            const res = await api.post('/support/chat', {
                message: text,
                conversation_id: conversationId,
            });

            const data = res.data;
            const newConversationId = data.conversation_id;

            if (newConversationId && newConversationId !== conversationId) {
                setConversationId(newConversationId);
                if (newConversationId !== 'ephemeral') {
                    localStorage.setItem('docnow_support_conversation_id', newConversationId);
                } else {
                    localStorage.removeItem('docnow_support_conversation_id');
                }
            }

            const assistantMessage: ChatMessage = {
                id: data.message_id || data.message?.id || Date.now().toString(),
                role: 'assistant',
                content: data.content || data.message?.content || '',
                sources: data.sources?.map((s: any) => ({
                    title: s.title || '',
                    url: s.url,
                    type: s.source_type || s.type,
                })) || data.message?.sources || [],
                actions: data.actions_taken?.map((a: any) => a.summary) || data.message?.actions || [],
                cards: toProductCards(data.cards),
                verified: data.verified ?? data.message?.verified ?? false,
                wasAbstained: data.was_abstained ?? data.message?.wasAbstained ?? false,
                createdAt: new Date().toISOString(),
            };

            setMessages((prev) => [...prev, assistantMessage]);
        } catch (err: any) {
            console.error('Failed to send message:', err);
            const status = err?.response?.status;
            // 404 = conversation gone; 400 = turn cap reached, so this id can never accept another message.
            if (status === 404 || status === 400) {
                localStorage.removeItem('docnow_support_conversation_id');
                setConversationId(null);
            }
            setError(serverErrorMessage(err) || 'Failed to send message.');
        } finally {
            setIsLoading(false);
        }
    };

    const submitFeedback = async (messageId: string, score: number) => {
        try {
            await api.post('/support/feedback', {
                message_id: messageId,
                score,
            });
            // Update message in state
            setMessages((prev) => prev.map((msg) => 
                msg.id === messageId ? { ...msg, feedbackScore: score } : msg
            ));
        } catch (err) {
            console.error('Failed to submit feedback:', err);
        }
    };

    return {
        messages,
        sendMessage,
        loadHistory,
        resetChat,
        submitFeedback,
        isLoading,
        error,
        conversationId,
        messagesEndRef,
    };
}
