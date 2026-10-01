"use client";

import React, { useState, useRef, KeyboardEvent } from 'react';
import { Send, Loader2 } from 'lucide-react';

interface ChatInputProps {
    onSend: (message: string) => void;
    isLoading: boolean;
}

export function ChatInput({ onSend, isLoading }: ChatInputProps) {
    const [text, setText] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const maxLength = 2000;

    const handleSend = () => {
        if (text.trim() && !isLoading && text.length <= maxLength) {
            onSend(text.trim());
            setText('');
            if (textareaRef.current) {
                textareaRef.current.style.height = 'auto';
            }
        }
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setText(e.target.value);
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
        }
    };

    const charsLeft = Math.max(0, maxLength - text.length);
    const isOverLimit = text.length > maxLength;

    return (
        <div className="flex flex-col gap-1 w-full bg-white border-t p-3 border-gray-100">
            <div className="relative flex items-end w-full gap-2 bg-gray-50 rounded-2xl border border-gray-200 focus-within:border-indigo-300 focus-within:ring-1 focus-within:ring-indigo-300 p-2">
                <textarea
                    ref={textareaRef}
                    value={text}
                    onChange={handleInput}
                    onKeyDown={handleKeyDown}
                    disabled={isLoading}
                    placeholder="Ask about tests, bookings, or policies..."
                    className="w-full resize-none bg-transparent outline-none text-sm p-1.5 max-h-[120px] min-h-[40px] text-gray-800 disabled:opacity-50"
                    rows={1}
                />
                <button
                    onClick={handleSend}
                    disabled={!text.trim() || isLoading || isOverLimit}
                    className="flex-shrink-0 mb-1 mr-1 p-2 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 disabled:opacity-50 disabled:hover:bg-indigo-600 transition-colors"
                >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
            </div>
            {(text.length > 0 || isOverLimit) && (
                <div className={`text-xs text-right pr-2 ${isOverLimit ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                    {text.length}/{maxLength}
                </div>
            )}
        </div>
    );
}
