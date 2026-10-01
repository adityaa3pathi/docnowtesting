"use client";

import React, { useState, useEffect } from 'react';
import { MessageCircle, X, Minus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { useSupportChat } from '@/hooks/useSupportChat';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';

export function SupportChat() {
    const { isAuthenticated, isInitialized } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const [hasUnread, setHasUnread] = useState(false);
    
    const {
        messages,
        sendMessage,
        submitFeedback,
        isLoading,
        error,
        messagesEndRef
    } = useSupportChat();

    // Mark as read when opened
    useEffect(() => {
        if (isOpen) {
            setHasUnread(false);
        }
    }, [isOpen]);

    // Simple unread badge logic: if a new assistant message arrives while closed
    useEffect(() => {
        if (!isOpen && messages.length > 0) {
            const lastMessage = messages[messages.length - 1];
            if (lastMessage.role === 'assistant' && lastMessage.id !== 'welcome') {
                setHasUnread(true);
            }
        }
    }, [messages, isOpen]);

    if (!isInitialized || !isAuthenticated) {
        return null; // Only show for authenticated users
    }

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 20, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 20, scale: 0.95 }}
                        transition={{ duration: 0.2 }}
                        className="mb-4 bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden flex flex-col w-[calc(100vw-3rem)] sm:w-[400px] h-[500px] max-h-[calc(100vh-8rem)]"
                    >
                        {/* Header */}
                        <div className="bg-indigo-600 text-white px-4 py-3 flex items-center justify-between shadow-sm">
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                                    <MessageCircle className="w-5 h-5 text-white" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-sm">DocNow Support</h3>
                                    <p className="text-[10px] text-indigo-100 opacity-90">AI Assistant</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-1">
                                <button 
                                    onClick={() => setIsOpen(false)}
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
                                            <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                                            <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                                            <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"></span>
                                        </div>
                                    </div>
                                </div>
                            )}
                            {error && (
                                <div className="text-xs text-center text-red-500 my-2 bg-red-50 py-2 rounded-lg border border-red-100">
                                    {error}
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
                onClick={() => setIsOpen(!isOpen)}
                className="w-14 h-14 bg-indigo-600 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-indigo-700 transition-colors relative focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-600"
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
