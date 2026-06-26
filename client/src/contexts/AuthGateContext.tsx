'use client';

import React, { createContext, useContext, useState, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { AuthDialog } from '@/components/AuthDialog';
import toast from 'react-hot-toast';

interface AuthGateContextType {
    /** If authenticated, runs action immediately. Otherwise opens login dialog and replays after login. */
    requireAuth: (pendingAction: () => void) => void;
    /** Programmatically open the auth dialog (e.g. from Sign In button) */
    openAuthDialog: () => void;
    /** Close the auth dialog */
    closeAuthDialog: () => void;
    /** Whether the auth dialog is currently open */
    isAuthDialogOpen: boolean;
}

const AuthGateContext = createContext<AuthGateContextType | null>(null);

export function AuthGateProvider({ children }: { children: React.ReactNode }) {
    const { isAuthenticated } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const pendingActionRef = useRef<(() => void) | null>(null);

    const requireAuth = useCallback(
        (action: () => void) => {
            if (isAuthenticated) {
                action();
                return;
            }
            // Save the action to replay after login
            pendingActionRef.current = action;
            setIsOpen(true);
        },
        [isAuthenticated]
    );

    const openAuthDialog = useCallback(() => {
        pendingActionRef.current = null;
        setIsOpen(true);
    }, []);

    const closeAuthDialog = useCallback(() => {
        pendingActionRef.current = null;
        setIsOpen(false);
    }, []);

    const handleLoginSuccess = useCallback(() => {
        setIsOpen(false);
        // Small delay to let auth state propagate before replaying the action
        const action = pendingActionRef.current;
        if (action) {
            pendingActionRef.current = null;
            setTimeout(() => {
                action();
                toast.success('Logged in! Completing your action...');
            }, 300);
        }
    }, []);

    return (
        <AuthGateContext.Provider
            value={{ requireAuth, openAuthDialog, closeAuthDialog, isAuthDialogOpen: isOpen }}
        >
            {children}
            <AuthDialog
                isOpen={isOpen}
                onClose={closeAuthDialog}
                onLoginSuccess={handleLoginSuccess}
            />
        </AuthGateContext.Provider>
    );
}

export function useAuthGate() {
    const ctx = useContext(AuthGateContext);
    if (!ctx) throw new Error('useAuthGate must be used within <AuthGateProvider>');
    return ctx;
}
