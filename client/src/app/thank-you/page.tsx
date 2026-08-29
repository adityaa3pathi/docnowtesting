import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ThankYouClient } from './ThankYouClient';
import { Loader2 } from 'lucide-react';

export const metadata: Metadata = {
    title: 'Order Confirmed - DOCNOW',
    description: 'Thank you for your order with DOCNOW. Your health test booking is confirmed.',
};

function ThankYouFallback() {
    return (
        <div className="min-h-[75vh] flex flex-col items-center justify-center p-6 bg-gradient-to-b from-purple-50/40 via-white to-gray-50/50">
            <div className="w-14 h-14 rounded-2xl bg-purple-50 border border-purple-100 flex items-center justify-center text-primary mb-4 shadow-sm animate-pulse">
                <Loader2 className="w-7 h-7 animate-spin text-primary" />
            </div>
            <h2 className="text-lg font-bold text-gray-800 mb-1">Confirming Your Booking...</h2>
            <p className="text-sm font-medium text-gray-500">Retrieving your order details</p>
        </div>
    );
}

export default function ThankYouPage() {
    return (
        <Suspense fallback={<ThankYouFallback />}>
            <ThankYouClient />
        </Suspense>
    );
}
