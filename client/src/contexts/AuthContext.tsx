"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import api, { setAccessToken } from '@/lib/api';

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

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [isInitialized, setIsInitialized] = useState(false);

    // Stable ref for the logout callback — avoids re-renders when CartContext registers.
    const logoutCallbackRef = useRef<(() => void) | null>(null);

    const onLogout = useCallback((cb: () => void) => {
        logoutCallbackRef.current = cb;
    }, []);

    // Bootstrap: try silent refresh on mount
    useEffect(() => {
        api.get('/auth/me')
            .then(res => {
                setUser(res.data.user);
            })
            .catch(() => {
                // Not logged in — that's fine
                setAccessToken(null);
            })
            .finally(() => setIsInitialized(true));
    }, []);

    const login = (userData: User) => {
        // Server already set cookies. Just store user in state.
        setUser(userData);
    };

    const updateUser = (userData: Partial<User>) => {
        if (user) {
            setUser({ ...user, ...userData });
        }
    };

    const logout = async () => {
        // Invoke registered callbacks (e.g. cart reset) synchronously
        logoutCallbackRef.current?.();
        try { await api.post('/auth/logout'); } catch (err) { console.error('Logout failed:', err); }
        setAccessToken(null);
        setUser(null);
    };

    const logoutAll = async () => {
        logoutCallbackRef.current?.();
        try { await api.post('/auth/logout-all'); } catch (err) { console.error('Logout All failed:', err); }
        setAccessToken(null);
        setUser(null);
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
