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

    // Very basic markdown rendering for **bold** and \n to <br>
    const renderContent = (text: string) => {
        // Split by newlines first
        const paragraphs = text.split('\\n');
        
        return paragraphs.map((p, i) => {
            // Split by **
            const parts = p.split(/\\*\\*(.*?)\\*\\*/g);
            return (
                <span key={i}>
                    {parts.map((part, j) => {
                        // Even indices are normal text, odd indices are bolded because of the split regex with capturing group
                        if (j % 2 === 1) {
                            return <strong key={j} className="font-semibold">{part}</strong>;
                        }
                        return <span key={j}>{part}</span>;
                    })}
                    {i < paragraphs.length - 1 && <br />}
                </span>
            );
        });
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
                <div className="text-sm leading-relaxed whitespace-pre-wrap word-break">
                    {renderContent(message.content)}
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
