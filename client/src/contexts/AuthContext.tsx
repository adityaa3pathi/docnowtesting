/**
 * ==========================================
 * AUTH CONTEXT
 * ==========================================
 * 
 * Global state manager for user authentication.
 * 
 * Strategy: "Optimistic hydration"
 * - On mount, user metadata is read synchronously from localStorage → instant avatar.
 * - /auth/me validates the session in the background.
 *   - If valid: updates user (in case profile changed on another device).
 *   - If expired/invalid: clears user + localStorage → Sign In shown.
 * - Login/logout write to localStorage so the next page load is also instant.
 * 
 * Note: Actual JWTs are stored in HttpOnly cookies or memory; this context only stores the user metadata.
 */
"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import api, { setAccessToken } from '@/lib/api';

const AUTH_STORAGE_KEY = 'docnow_user';

interface User {
    id: string;
    name?: string;
    email?: string;
    mobile: string;
    role?: string;
}

interface AuthContextType {
    user: User | null;
    login: (user: User) => void;
    logout: () => void;
    logoutAll: () => void;
    updateUser: (userData: Partial<User>) => void;
    isAuthenticated: boolean;
    isInitialized: boolean;
    /** Register a callback that will be invoked synchronously during logout.
     *  Used by CartContext to clear cart state in the same render cycle. */
    onLogout: (cb: () => void) => void;
}

/**
 * Read user from localStorage synchronously.
 * Returns null if nothing stored, parsing fails, or running on server.
 */
function getCachedUser(): User | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = localStorage.getItem(AUTH_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        // Basic shape check — must have id and mobile
        if (parsed && typeof parsed.id === 'string' && typeof parsed.mobile === 'string') {
            return parsed as User;
        }
        return null;
    } catch {
        return null;
    }
}

/** Persist user metadata to localStorage. */
function setCachedUser(user: User | null) {
    if (typeof window === 'undefined') return;
    try {
        if (user) {
            localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
        } else {
            localStorage.removeItem(AUTH_STORAGE_KEY);
        }
    } catch {
        // Storage full or blocked — non-critical
    }
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    // Initialize from localStorage — synchronous, no flash
    const [user, setUser] = useState<User | null>(getCachedUser);
    const [isInitialized, setIsInitialized] = useState(false);

    // Stable ref for the logout callback — avoids re-renders when CartContext registers.
    const logoutCallbackRef = useRef<(() => void) | null>(null);

    const onLogout = useCallback((cb: () => void) => {
        logoutCallbackRef.current = cb;
    }, []);

    // Background validation: confirm session is still valid
    useEffect(() => {
        api.get('/auth/me')
            .then(res => {
                const serverUser = res.data.user;
                setUser(serverUser);
                setCachedUser(serverUser); // Sync latest profile data
            })
            .catch(() => {
                // Session expired or invalid — clear everything
                setAccessToken(null);
                setUser(null);
                setCachedUser(null);
            })
            .finally(() => setIsInitialized(true));
    }, []);

    const login = (userData: User) => {
        // Server already set cookies. Store user in state + localStorage.
        setUser(userData);
        setCachedUser(userData);
    };

    const updateUser = (userData: Partial<User>) => {
        if (user) {
            const updated = { ...user, ...userData };
            setUser(updated);
            setCachedUser(updated);
        }
    };

    const logout = async () => {
        // Invoke registered callbacks (e.g. cart reset) synchronously
        logoutCallbackRef.current?.();
        try { await api.post('/auth/logout'); } catch (err) { console.error('Logout failed:', err); }
        setAccessToken(null);
        setUser(null);
        setCachedUser(null);
    };

    const logoutAll = async () => {
        logoutCallbackRef.current?.();
        try { await api.post('/auth/logout-all'); } catch (err) { console.error('Logout All failed:', err); }
        setAccessToken(null);
        setUser(null);
        setCachedUser(null);
    };

    return (
        <AuthContext.Provider value={{
            user,
            login,
            logout,
            logoutAll,
            updateUser,
            isAuthenticated: !!user,
            isInitialized,
            onLogout
        }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
