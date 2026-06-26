'use client';

import Link from 'next/link';
import { Phone, MessageCircle, ShoppingCart } from 'lucide-react';
import { useCart } from '@/contexts/CartContext';
import { usePathname } from 'next/navigation';
import { SUPPORT_PHONE_LINK } from '@/lib/supportConfig';

const WHATSAPP_NUMBER = '919649089089';
const WHATSAPP_MESSAGE = encodeURIComponent('Hi DocNow, I want to book a lab test.');

export function StickyMobileCTA() {
    const { cartCount } = useCart();
    const pathname = usePathname();

    // Hide on cart, checkout, manager, and super-admin pages
    const hiddenPaths = ['/cart', '/checkout', '/manager', '/super-admin', '/profile'];
    if (hiddenPaths.some(p => pathname.startsWith(p))) return null;

    return (
        <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden">
            {/* Glass bar */}
            <div
                className="flex items-stretch border-t border-white/20 bg-white/95 backdrop-blur-xl shadow-[0_-4px_24px_rgba(0,0,0,0.08)]"
                style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
            >
                {/* Call */}
                <a
                    href={`tel:${SUPPORT_PHONE_LINK}`}
                    className="flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-gray-700 active:bg-gray-100 transition-colors"
                    aria-label="Call us"
                >
                    <div className="flex items-center justify-center w-9 h-9 rounded-full bg-green-50">
                        <Phone className="w-4.5 h-4.5 text-green-600" />
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Call</span>
                </a>

                {/* WhatsApp */}
                <a
                    href={`https://wa.me/${WHATSAPP_NUMBER}?text=${WHATSAPP_MESSAGE}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-gray-700 active:bg-gray-100 transition-colors"
                    aria-label="Chat on WhatsApp"
                >
                    <div className="flex items-center justify-center w-9 h-9 rounded-full bg-emerald-50">
                        <MessageCircle className="w-4.5 h-4.5 text-emerald-600" />
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">WhatsApp</span>
                </a>

                {/* Cart */}
                <Link
                    href="/cart"
                    className="flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-gray-700 active:bg-gray-100 transition-colors relative"
                    aria-label="Go to cart"
                >
                    <div className="relative flex items-center justify-center w-9 h-9 rounded-full bg-purple-50">
                        <ShoppingCart className="w-4.5 h-4.5 text-purple-600" />
                        {cartCount > 0 && (
                            <span className="absolute -top-1 -right-1 flex items-center justify-center h-[18px] min-w-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none shadow-sm">
                                {cartCount > 9 ? '9+' : cartCount}
                            </span>
                        )}
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Cart</span>
                </Link>
            </div>
        </div>
    );
}
