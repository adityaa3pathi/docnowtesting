"use client";

import React from 'react';
import { ThumbsUp, ThumbsDown, CheckCircle, ShieldAlert, Link as LinkIcon, Info } from 'lucide-react';
import type { ChatMessage as ChatMessageType, ChatSource } from '@/hooks/useSupportChat';
import { clsx } from 'clsx';

interface ChatMessageProps {
    message: ChatMessageType;
    onFeedback?: (messageId: string, score: number) => void;
}

export function ChatMessage({ message, onFeedback }: ChatMessageProps) {
    const isUser = message.role === 'user';
    const hasFeedback = message.feedbackScore !== undefined;

    // Inline tokenizer for bold (**text**), italic (*text*), code (`code`), links ([text](url)), and emails
    const renderInline = (text: string): React.ReactNode[] => {
        const tokens: React.ReactNode[] = [];
        let remaining = text;
        const pattern = /(\*\*(.+?)\*\*)|(\*([^\*]+)\*)|(`([^`]+)`)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(https?:\/\/[^\s<]+)|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;

        let key = 0;
        while (remaining.length > 0) {
            const match = remaining.match(pattern);
            if (!match) {
                tokens.push(remaining);
                break;
            }

            const matchIndex = match.index ?? 0;
            if (matchIndex > 0) {
                tokens.push(remaining.slice(0, matchIndex));
            }

            if (match[1]) {
                // **bold**
                tokens.push(
                    <strong key={`b-${key++}`} className={clsx('font-semibold', isUser ? 'text-white' : 'text-gray-900')}>
                        {match[2]}
                    </strong>
                );
            } else if (match[3]) {
                // *italic*
                tokens.push(
                    <em key={`i-${key++}`} className="italic">
                        {match[4]}
                    </em>
                );
            } else if (match[5]) {
                // `code`
                tokens.push(
                    <code key={`c-${key++}`} className="px-1 py-0.5 rounded text-xs bg-gray-100 font-mono text-indigo-700">
                        {match[6]}
                    </code>
                );
            } else if (match[7]) {
                // [text](url)
                tokens.push(
                    <a
                        key={`l-${key++}`}
                        href={match[9]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={clsx('underline', isUser ? 'text-white' : 'text-indigo-600 hover:text-indigo-800')}
                    >
                        {match[8]}
                    </a>
                );
            } else if (match[10]) {
                // raw URL
                tokens.push(
                    <a
                        key={`u-${key++}`}
                        href={match[10]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={clsx('underline break-all', isUser ? 'text-white' : 'text-indigo-600 hover:text-indigo-800')}
                    >
                        {match[10]}
                    </a>
                );
            } else if (match[11]) {
                // email
                tokens.push(
                    <a
                        key={`e-${key++}`}
                        href={`mailto:${match[11]}`}
                        className={clsx('underline', isUser ? 'text-white' : 'text-indigo-600 hover:text-indigo-800')}
                    >
                        {match[11]}
                    </a>
                );
            }

            remaining = remaining.slice(matchIndex + match[0].length);
        }
        return tokens;
    };

    // Block parser for paragraphs, bullet lists (*, -, •), and numbered lists (1., 2.)
    const renderMarkdownContent = (text: string) => {
        if (!text) return null;

        const lines = text.split(/\r?\n/);
        const elements: React.ReactNode[] = [];
        let currentList: { type: 'ul' | 'ol'; items: { text: string; num?: string }[] } | null = null;
        let blockKey = 0;

        const flushList = () => {
            if (!currentList) return;
            if (currentList.type === 'ul') {
                elements.push(
                    <ul key={`ul-${blockKey++}`} className="my-1.5 space-y-1 pl-1">
                        {currentList.items.map((item, idx) => (
                            <li key={idx} className="flex items-start gap-2 text-sm leading-relaxed">
                                <span className={clsx('mt-1.5 text-xs select-none', isUser ? 'text-indigo-200' : 'text-indigo-500')}>•</span>
                                <span className="flex-1">{renderInline(item.text)}</span>
                            </li>
                        ))}
                    </ul>
                );
            } else {
                elements.push(
                    <ol key={`ol-${blockKey++}`} className="my-1.5 space-y-1 pl-1">
                        {currentList.items.map((item, idx) => (
                            <li key={idx} className="flex items-start gap-2 text-sm leading-relaxed">
                                <span className={clsx('font-semibold select-none text-xs min-w-[14px]', isUser ? 'text-indigo-200' : 'text-indigo-600')}>
                                    {item.num}.
                                </span>
                                <span className="flex-1">{renderInline(item.text)}</span>
                            </li>
                        ))}
                    </ol>
                );
            }
            currentList = null;
        };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            if (!trimmed) {
                flushList();
                continue;
            }

            // Bullet list item: "* ", "- ", "• "
            const bulletMatch = trimmed.match(/^[\*\-•]\s+(.*)$/);
            if (bulletMatch) {
                if (!currentList || currentList.type !== 'ul') {
                    flushList();
                    currentList = { type: 'ul', items: [] };
                }
                currentList.items.push({ text: bulletMatch[1] });
                continue;
            }

            // Numbered list item: "1. ", "2. "
            const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
            if (numMatch) {
                if (!currentList || currentList.type !== 'ol') {
                    flushList();
                    currentList = { type: 'ol', items: [] };
                }
                currentList.items.push({ num: numMatch[1], text: numMatch[2] });
                continue;
            }

            // Regular paragraph line
            flushList();
            elements.push(
                <p key={`p-${blockKey++}`} className="my-1 first:mt-0 last:mb-0 leading-relaxed">
                    {renderInline(line)}
                </p>
            );
        }

        flushList();
        return elements;
    };

    return (
        <div className={clsx('flex w-full mb-4', isUser ? 'justify-end' : 'justify-start')}>
            <div className={clsx(
                'max-w-[85%] rounded-2xl px-4 py-3 shadow-sm flex flex-col gap-2',
                isUser ? 'bg-indigo-600 text-white rounded-br-none' : 
                message.wasAbstained ? 'bg-orange-50 border border-orange-200 text-gray-800 rounded-bl-none' :
                'bg-white border border-gray-100 text-gray-800 rounded-bl-none'
            )}>
                {/* Header for assistant messages */}
                {!isUser && (
                    <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-semibold text-gray-500">DocNow Assistant</span>
                        {message.verified && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full border border-emerald-200">
                                <CheckCircle className="w-3 h-3" />
                                Verified
                            </span>
                        )}
                        {message.wasAbstained && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded-full">
                                <ShieldAlert className="w-3 h-3" />
                                Human Support Recommended
                            </span>
                        )}
                    </div>
                )}

                {/* Content */}
                <div className="text-sm leading-relaxed break-words">
                    {renderMarkdownContent(message.content)}
                </div>

                {/* Abstention specific contact info */}
                {message.wasAbstained && (
                    <div className="mt-2 bg-white/60 p-2 rounded text-xs text-orange-800 flex items-start gap-2 border border-orange-100">
                        <Info className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>For definitive answers, please contact our support team at <strong>1-800-DOCNOW</strong> or email <strong>support@docnow.com</strong>.</span>
                    </div>
                )}

                {/* Actions Summary */}
                {message.actions && message.actions.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-gray-100/50">
                        <div className="text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
                            Actions Taken
                        </div>
                        <ul className="text-xs space-y-1">
                            {message.actions.map((action, idx) => (
                                <li key={idx} className="flex items-start gap-1.5 text-gray-600">
                                    <CheckCircle className="w-3 h-3 text-indigo-400 mt-0.5 shrink-0" />
                                    <span>{action}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* Sources */}
                {message.sources && message.sources.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-gray-100/50">
                        <div className="flex flex-wrap gap-1.5">
                            {message.sources.map((source, idx) => (
                                source.url ? (
                                    <a key={idx} href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] bg-gray-50 border border-gray-200 text-gray-600 px-2 py-1 rounded-full hover:bg-gray-100 hover:text-indigo-600 transition-colors">
                                        <LinkIcon className="w-2.5 h-2.5" />
                                        {source.title}
                                    </a>
                                ) : (
                                    <span key={idx} className="inline-flex items-center gap-1 text-[10px] bg-gray-50 border border-gray-200 text-gray-600 px-2 py-1 rounded-full">
                                        {source.title}
                                    </span>
                                )
                            ))}
                        </div>
                    </div>
                )}

                {/* Footer / Feedback */}
                {!isUser && onFeedback && (
                    <div className="flex justify-end mt-1">
                        <div className="flex items-center gap-1">
                            <button 
                                onClick={() => onFeedback(message.id, 1)}
                                disabled={hasFeedback}
                                className={clsx(
                                    "p-1 rounded hover:bg-gray-100 transition-colors",
                                    message.feedbackScore === 1 ? "text-emerald-600 bg-emerald-50" : "text-gray-400"
                                )}
                                title="Helpful"
                            >
                                <ThumbsUp className="w-3 h-3" />
                            </button>
                            <button 
                                onClick={() => onFeedback(message.id, -1)}
                                disabled={hasFeedback}
                                className={clsx(
                                    "p-1 rounded hover:bg-gray-100 transition-colors",
                                    message.feedbackScore === -1 ? "text-rose-600 bg-rose-50" : "text-gray-400"
                                )}
                                title="Not helpful"
                            >
                                <ThumbsDown className="w-3 h-3" />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
