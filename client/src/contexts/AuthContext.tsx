"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface User {
    id: string;
    name?: string;
    email?: string;
    mobile: string;
    role?: string;
}

interface AuthContextType {
    user: User | null;
    token: string | null;
    login: (user: User, token: string) => void;
    logout: () => void;
    updateUser: (userData: Partial<User>) => void;
    isAuthenticated: boolean;
    isInitialized: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [isInitialized, setIsInitialized] = useState(false);

    useEffect(() => {
        const savedToken = localStorage.getItem('docnow_auth_token');
        const savedUser = localStorage.getItem('docnow_user');

        if (savedToken && savedUser) {
            setToken(savedToken);
            setUser(JSON.parse(savedUser));
        }
        setIsInitialized(true);
    }, []);

    const login = (userData: User, authToken: string) => {
        setToken(authToken);
        setUser(userData);
        localStorage.setItem('docnow_auth_token', authToken);
        localStorage.setItem('docnow_user', JSON.stringify(userData));
    };

    const updateUser = (userData: Partial<User>) => {
        if (user) {
            const updatedUser = { ...user, ...userData };
            setUser(updatedUser);
            localStorage.setItem('docnow_user', JSON.stringify(updatedUser));
        }
    };

    const logout = () => {
        setToken(null);
        setUser(null);
        localStorage.removeItem('docnow_auth_token');
        localStorage.removeItem('docnow_user');
    };

    return (
        <AuthContext.Provider value={{
            user,
            token,
            login,
            logout,
            updateUser,
            isAuthenticated: !!token,
            isInitialized
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
