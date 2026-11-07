"use client";

import React, { useState } from 'react';
import { MessageCircle, X, Minus, RotateCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePathname } from 'next/navigation';
import { useSupportChat } from '@/hooks/useSupportChat';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';

// Staff consoles and live calls: the customer assistant would only cover their controls.
const HIDDEN_ON = ['/doctor', '/manager', '/super-admin', '/checkout', '/call/'];

export function SupportChat() {
    const pathname = usePathname();
    const [isOpen, setIsOpen] = useState(false);
    const [seenReplyId, setSeenReplyId] = useState<string | null>(null);
    
    const {
        messages,
        sendMessage,
        resetChat,
        submitFeedback,
        isLoading,
        error,
        messagesEndRef
    } = useSupportChat();

    // Unread: the newest assistant reply arrived while the panel was closed.
    const last = messages[messages.length - 1];
    const lastReplyId = last?.role === 'assistant' && last.id !== 'welcome' ? last.id : null;
    const hasUnread = !isOpen && lastReplyId !== null && lastReplyId !== seenReplyId;
    const setOpen = (open: boolean) => {
        setIsOpen(open);
        setSeenReplyId(lastReplyId);
    };

    if (HIDDEN_ON.some((p) => pathname.startsWith(p))) return null;

    // --sticky-bottom is the height of the page's bottom bar (StickyBottomBar), so we sit above it.
    return (
        <div
            data-support-launcher
            className="fixed right-4 z-50 flex flex-col items-end transition-[bottom] duration-200 sm:right-6"
            style={{ bottom: 'calc(var(--sticky-bottom, 0px) + env(safe-area-inset-bottom, 0px) + 1rem)' }}
        >
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 20, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 20, scale: 0.95 }}
                        transition={{ duration: 0.2 }}
                        className="mb-4 bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden flex flex-col w-[calc(100vw-2rem)] sm:w-[400px] h-[500px]"
                        style={{ maxHeight: 'calc(100dvh - var(--sticky-bottom, 0px) - 7rem)' }}
                    >
                        {/* Header */}
                        <div className="text-white px-4 py-3 flex items-center justify-between shadow-sm" style={{ background: 'linear-gradient(135deg, #4b2192 0%, #6d3fcf 100%)' }}>
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                                    <MessageCircle className="w-5 h-5 text-white" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-sm">DocNow Support</h3>
                                    <p className="text-[10px] text-white/80 opacity-90">AI Assistant</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-1">
                                <button 
                                    onClick={resetChat}
                                    title="Start new conversation"
                                    className="p-1.5 hover:bg-white/20 rounded-md transition-colors"
                                >
                                    <RotateCcw className="w-4 h-4" />
                                </button>
                                <button 
                                    onClick={() => setOpen(false)}
                                    className="p-1.5 hover:bg-white/20 rounded-md transition-colors"
                                >
                                    <Minus className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Messages Area */}
                        <div className="flex-1 overflow-y-auto p-4 bg-gray-50/50 relative">
                            {messages.map(msg => (
                                <ChatMessage 
                                    key={msg.id} 
                                    message={msg} 
                                    onFeedback={submitFeedback}
                                />
                            ))}
                            {isLoading && (
                                <div className="flex w-full mb-4 justify-start">
                                    <div className="bg-white border border-gray-100 rounded-2xl rounded-bl-none px-4 py-3 shadow-sm flex items-center gap-2">
                                        <div className="flex gap-1">
                                            <span className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                                            <span className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                                            <span className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-bounce"></span>
                                        </div>
                                    </div>
                                </div>
                            )}
                            {error && (
                                <div className="text-xs text-red-600 my-2 bg-red-50 px-3 py-2 rounded-lg border border-red-100 flex items-center justify-between gap-2">
                                    <span>{error}</span>
                                    <button
                                        onClick={resetChat}
                                        className="text-[11px] underline text-primary hover:text-primary/80 font-medium shrink-0"
                                    >
                                        Start new chat
                                    </button>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input Area */}
                        <ChatInput onSend={sendMessage} isLoading={isLoading} />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Toggle Button */}
            <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setOpen(!isOpen)}
                aria-label={isOpen ? 'Close support chat' : 'Open support chat'}
                aria-expanded={isOpen}
                className="w-12 h-12 sm:w-14 sm:h-14 bg-primary text-white rounded-full shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors relative focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
            >
                {isOpen ? (
                    <X className="w-6 h-6" />
                ) : (
                    <>
                        <MessageCircle className="w-6 h-6" />
                        {hasUnread && (
                            <span className="absolute top-0 right-0 flex h-3.5 w-3.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-red-500 border-2 border-white"></span>
                            </span>
                        )}
                    </>
                )}
            </motion.button>
        </div>
    );
}
