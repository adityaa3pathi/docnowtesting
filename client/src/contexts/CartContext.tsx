"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { useAuth } from './AuthContext';

interface Patient {
    id: string;
    name: string;
    relation: string;
}

interface CartItem {
    id: string;
    testCode: string;
    testName: string;
    price: number;
    mrp?: number | null;
    patientId?: string | null;
    patient?: Patient | null;
}

interface Cart {
    id: string;
    userId: string;
    items: CartItem[];
}

interface CartContextType {
    cart: Cart | null;
    cartCount: number;
    loading: boolean;
    /** The last load failed; the cart is unknown, which is not the same as empty. */
    loadFailed: boolean;
    /** `idempotencyKey`: the same key twice adds once (chat cards send one per tap). */
    addToCart: (testCode: string, testName: string, price: number, mrp?: number, opts?: { idempotencyKey?: string }) => Promise<boolean>;
    removeFromCart: (itemId: string) => Promise<void>;
    updateCartItem: (itemId: string, patientId: string | null) => Promise<void>;
    clearCart: () => Promise<void>;
    refreshCart: () => Promise<void>;
    resetCart: () => void;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export function useCart() {
    const context = useContext(CartContext);
    if (!context) {
        throw new Error('useCart must be used within a CartProvider');
    }
    return context;
}

export function CartProvider({ children }: { children: ReactNode }) {
    const [cart, setCart] = useState<Cart | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadFailed, setLoadFailed] = useState(false);
    const { isAuthenticated, isInitialized, onLogout } = useAuth();
    // Bumped on every load and on logout, so a late /cart reply from an old account is dropped.
    const generation = useRef(0);

    const fetchCart = async () => {
        const mine = ++generation.current;
        if (!isAuthenticated) {
            setCart(null);
            setLoadFailed(false);
            return;
        }

        try {
            setLoading(true);
            const response = await api.get('/cart');
            if (mine !== generation.current) return;
            setCart(response.data);
            setLoadFailed(false);
        } catch (error: any) {
            if (mine !== generation.current) return;
            console.warn('[Cart] Could not load cart:', error?.message || error);
            setLoadFailed(true);
        } finally {
            if (mine === generation.current) setLoading(false);
        }
    };

    // Synchronous cart reset — clears all local cart state immediately,
    // without waiting for any API call. Used during logout so the badge
    // and cart page reflect the signed-out state in the same render cycle.
    const resetCart = useCallback(() => {
        generation.current++;
        setCart(null);
        setLoading(false);
        setLoadFailed(false);
    }, []);

    // Register resetCart as the logout callback so AuthContext.logout()
    // can clear cart state synchronously before any re-render.
    useEffect(() => {
        onLogout(resetCart);
    }, [onLogout, resetCart]);

    useEffect(() => {
        if (isInitialized) {
            fetchCart();
        }
    }, [isAuthenticated, isInitialized]);

    const addToCart = async (testCode: string, testName: string, price: number, mrp?: number, opts?: { idempotencyKey?: string }): Promise<boolean> => {
        try {
            await api.post('/cart/items', {
                testCode,
                testName,
                price,
                mrp: mrp || null
            }, opts?.idempotencyKey ? { headers: { 'Idempotency-Key': opts.idempotencyKey } } : undefined);
            await fetchCart();
            return true;
        } catch (error: any) {
            console.error('Error adding to cart:', error);
            // Even if duplicate wasn't an error, we now allow it.
            // If API returns success, we are good.
            toast.error('Failed to add item to cart');
            return false;
        }
    };

    const removeFromCart = async (itemId: string) => {
        try {
            await api.delete(`/cart/items/${itemId}`);
            await fetchCart();
        } catch (error) {
            console.error('Error removing from cart:', error);
            toast.error('Failed to remove item from cart');
        }
    };

    const updateCartItem = async (itemId: string, patientId: string | null) => {
        try {
            await api.put(`/cart/items/${itemId}`, { patientId });
            await fetchCart();
        } catch (error) {
            console.error('Error updating cart item:', error);
            toast.error('Failed to update cart item');
        }
    };

    const clearCart = async () => {
        try {
            await api.delete('/cart');
            await fetchCart();
        } catch (error) {
            console.error('Error clearing cart:', error);
            toast.error('Failed to clear cart');
        }
    };

    const refreshCart = async () => {
        await fetchCart();
    };

    const cartCount = cart?.items?.length || 0;

    return (
        <CartContext.Provider value={{
            cart,
            cartCount,
            loading,
            loadFailed,
            addToCart,
            removeFromCart,
            updateCartItem,
            clearCart,
            refreshCart,
            resetCart
        }}>
            {children}
        </CartContext.Provider>
    );
}
