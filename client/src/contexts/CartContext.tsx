"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
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
    addToCart: (testCode: string, testName: string, price: number, mrp?: number) => Promise<boolean>;
    removeFromCart: (itemId: string) => Promise<void>;
    updateCartItem: (itemId: string, patientId: string | null) => Promise<void>;
    clearCart: () => Promise<void>;
    refreshCart: () => Promise<void>;
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
    const { isAuthenticated, isInitialized } = useAuth();

    const fetchCart = async () => {
        if (!isAuthenticated) {
            setCart(null);
            return;
        }

        try {
            setLoading(true);
            const response = await api.get('/cart');
            setCart(response.data);
        } catch (error) {
            console.error('Error fetching cart:', error);
            setCart(null);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isInitialized) {
            fetchCart();
        }
    }, [isAuthenticated, isInitialized]);

    const addToCart = async (testCode: string, testName: string, price: number, mrp?: number): Promise<boolean> => {
        try {
            await api.post('/cart/items', {
                testCode,
                testName,
                price,
                mrp: mrp || null
            });
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
            addToCart,
            removeFromCart,
            updateCartItem,
            clearCart,
            refreshCart
        }}>
            {children}
        </CartContext.Provider>
    );
}
