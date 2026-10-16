import { useState, useEffect, useCallback, useRef } from 'react';
import api from '@/lib/api';

export interface ChatSource {
    title: string;
    url?: string;
    type?: string;
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    sources?: ChatSource[];
    actions?: string[];
    verified?: boolean;
    wasAbstained?: boolean;
    feedbackScore?: number;
    createdAt: string;
}

export function useSupportChat() {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
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

    // Load from local storage on mount
    useEffect(() => {
        const storedId = localStorage.getItem('docnow_support_conversation_id');
        if (storedId && storedId !== 'ephemeral') {
            setConversationId(storedId);
            loadHistory(storedId);
        } else {
            // Give an initial greeting message
            setMessages([
                {
                    id: 'welcome',
                    role: 'assistant',
                    content: 'Hello! I am DocNow\'s AI support assistant. How can I help you today?',
                    createdAt: new Date().toISOString(),
                }
            ]);
        }
    }, []);

    const loadHistory = async (id: string) => {
        if (!id || id === 'ephemeral') return;
        setIsLoading(true);
        setError(null);
        try {
            const res = await api.get(`/support/history?conversation_id=${id}`);
            if (res.data && Array.isArray(res.data.messages)) {
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
                    verified: m.verified ?? false,
                    wasAbstained: m.was_abstained ?? m.wasAbstained ?? false,
                    feedbackScore: m.feedback_score ?? m.feedbackScore,
                    createdAt: m.created_at ?? m.createdAt ?? new Date().toISOString(),
                }));
                setMessages(formatted);
            }
        } catch (err: any) {
            console.error('Failed to load chat history:', err);
            setError('Failed to load chat history.');
        } finally {
            setIsLoading(false);
        }
    };

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
                verified: data.verified ?? data.message?.verified ?? false,
                wasAbstained: data.was_abstained ?? data.message?.wasAbstained ?? false,
                createdAt: new Date().toISOString(),
            };

            setMessages((prev) => [...prev, assistantMessage]);
        } catch (err: any) {
            console.error('Failed to send message:', err);
            setError('Failed to send message.');
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
        submitFeedback,
        isLoading,
        error,
        conversationId,
        messagesEndRef,
    };
}
