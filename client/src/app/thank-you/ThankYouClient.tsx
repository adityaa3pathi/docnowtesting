'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
    CheckCircle2,
    Calendar,
    Clock,
    MapPin,
    ArrowRight,
    ShieldCheck,
    FileText,
    Sparkles,
    Phone,
    ShoppingBag,
    Award,
    Lock,
    Truck,
    FlaskConical,
    AlertCircle
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button, Card } from '@/components/ui';
import { Footer } from '@/components/Footer';
import api from '@/lib/api';

type Outcome = 'confirmed' | 'pending' | 'refunded' | 'not_paid';

const POLL_EVERY_MS = 5_000;
const POLL_FOR_MS = 3 * 60_000;

const HERO: Record<Outcome, { title: string; text: string; icon: typeof CheckCircle2; ring: string; fill: string }> = {
    confirmed: {
        title: 'Booking Successful!',
        text: 'Your health test booking has been placed.',
        icon: CheckCircle2, ring: 'from-emerald-500 to-teal-400 shadow-emerald-500/20', fill: 'bg-emerald-500',
    },
    pending: {
        title: 'Confirming your booking…',
        text: 'Your payment is received. We are confirming the slot with the lab; this page updates by itself.',
        icon: Clock, ring: 'from-amber-500 to-orange-400 shadow-amber-500/20', fill: 'bg-amber-500',
    },
    refunded: {
        title: 'We could not book this test',
        text: 'The lab could not take this booking, so we have refunded you. Card refunds reach your account in 5-7 working days; wallet money is back now.',
        icon: AlertCircle, ring: 'from-red-500 to-rose-400 shadow-red-500/20', fill: 'bg-red-500',
    },
    not_paid: {
        title: 'Payment not completed',
        text: 'No booking was made. If money left your account, your bank returns it automatically. Your cart is still saved.',
        icon: AlertCircle, ring: 'from-gray-500 to-gray-400 shadow-gray-500/20', fill: 'bg-gray-500',
    },
};

interface BookingStatusData {
    outcome?: Outcome;
    bookingStatus?: string;
    slotDate?: string;
    slotTime?: string;
    address?: {
        line1?: string;
        city?: string;
        pincode?: string;
    };
    totalAmount?: number;
    items?: Array<{
        testName: string;
        price?: number;
        patientName?: string;
    }>;
}

export function ThankYouClient() {
    const searchParams = useSearchParams();
    const { user, isAuthenticated } = useAuth();

    const bookingId = searchParams.get('bookingId') || searchParams.get('id') || searchParams.get('order_id') || '';
    const queryStatus = searchParams.get('status') || '';

    const [bookingDetails, setBookingDetails] = useState<BookingStatusData | null>(null);
    const [outcome, setOutcome] = useState<Outcome | null>(null);
    const [slow, setSlow] = useState(false);

    // Polls the real payment outcome; "success" is only shown once the lab booking exists.
    useEffect(() => {
        if (!bookingId || !isAuthenticated) return;
        let stopped = false;
        let timer: ReturnType<typeof setTimeout>;
        const startedAt = Date.now();
        const poll = async () => {
            try {
                const res = await api.get(`/bookings/${encodeURIComponent(bookingId)}/payment-status`);
                if (stopped) return;
                setBookingDetails(res.data);
                setOutcome(res.data.outcome);
                if (res.data.outcome !== 'pending') return;
            } catch {
                if (stopped) return;
            }
            if (Date.now() - startedAt > POLL_FOR_MS) return setSlow(true);
            timer = setTimeout(poll, POLL_EVERY_MS);
        };
        void poll();
        return () => {
            stopped = true;
            clearTimeout(timer);
        };
    }, [bookingId, isAuthenticated]);

    // Without a booking to read (logged out, old link), stay neutral rather than claim success.
    const view: Outcome = outcome ?? (bookingId && isAuthenticated ? 'pending' : queryStatus === 'pending' ? 'pending' : 'confirmed');
    const hero = HERO[view];
    const HeroIcon = hero.icon;
    const showNextSteps = view === 'confirmed' || view === 'pending';

    return (
        <main
            className="min-h-screen bg-gradient-to-b from-purple-50/40 via-white to-gray-50/50 flex flex-col justify-between"
            data-page-type="thank-you"
            data-booking-id={bookingId}
            data-order-status={view.toUpperCase()}
        >
            <div className="container mx-auto px-4 py-8 md:py-14 max-w-4xl flex-grow">
                {/* ═══════════ HERO BANNER ═══════════ */}
                <div className="text-center mb-8 md:mb-12">
                    {/* Status icon */}
                    <div className="inline-flex items-center justify-center relative mb-5">
                        <div className={`w-20 h-20 md:w-24 md:h-24 rounded-full bg-gradient-to-tr ${hero.ring} p-0.5 shadow-xl flex items-center justify-center animate-in zoom-in-75 duration-300`}>
                            <div className={`w-full h-full ${hero.fill} rounded-full flex items-center justify-center text-white`}>
                                <HeroIcon className="w-10 h-10 md:w-12 md:h-12 stroke-[2.5]" aria-hidden />
                            </div>
                        </div>
                        {view === 'confirmed' && (
                            <div className="absolute -top-1 -right-1 bg-purple-600 text-white rounded-full p-1.5 shadow-md">
                                <Sparkles className="w-4 h-4" aria-hidden />
                            </div>
                        )}
                    </div>

                    <div role="status" aria-live="polite">
                        <h1 className="text-3xl md:text-5xl font-black text-gray-900 tracking-tight mb-3">
                            {hero.title}
                        </h1>
                        <p className="text-base md:text-lg text-gray-600 font-medium max-w-xl mx-auto">
                            {view === 'confirmed' ? `Thank you${user?.name ? `, ${user.name}` : ''}! ${hero.text}` : hero.text}
                        </p>
                        {view === 'pending' && slow && (
                            <p className="mt-3 text-sm font-semibold text-amber-800 max-w-xl mx-auto">
                                This is taking longer than usual. We will message you on WhatsApp once it is confirmed, or refund you if it cannot be booked.
                            </p>
                        )}
                        {view === 'not_paid' && (
                            <Link href="/cart" className="mt-5 inline-block">
                                <Button>Back to cart</Button>
                            </Link>
                        )}
                    </div>
                </div>

                {/* ═══════════ MAIN CONTENT GRID ═══════════ */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                    {/* Left & Middle Column (Span 2) */}
                    <div className="md:col-span-2 space-y-6">
                        {/* What Happens Next Card */}
                        {showNextSteps && <Card className="p-6 md:p-8 bg-white border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                            <div className="flex items-center gap-2.5 mb-6">
                                <div className="w-8 h-8 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center text-primary">
                                    <Truck className="w-4 h-4" />
                                </div>
                                <h2 className="text-lg md:text-xl font-black text-gray-900">
                                    What Happens Next?
                                </h2>
                            </div>

                            <div className="space-y-6 relative before:absolute before:left-4 before:top-3 before:bottom-3 before:w-0.5 before:bg-purple-100">
                                {/* Step 1 */}
                                <div className="flex items-start gap-4 relative">
                                    <div className="w-8 h-8 rounded-full bg-primary text-white text-xs font-black flex items-center justify-center shrink-0 shadow-md shadow-primary/20 z-10">
                                        1
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-bold text-gray-900">Phlebotomist Assignment</h3>
                                        <p className="text-xs md:text-sm text-gray-500 mt-1 leading-relaxed">
                                            A certified and vaccinated healthcare professional will be assigned to your booking. You will receive real-time SMS & WhatsApp alerts.
                                        </p>
                                    </div>
                                </div>

                                {/* Step 2 */}
                                <div className="flex items-start gap-4 relative">
                                    <div className="w-8 h-8 rounded-full bg-purple-100 text-primary text-xs font-black flex items-center justify-center shrink-0 border border-purple-200 z-10">
                                        2
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-bold text-gray-900">Doorstep Sample Collection</h3>
                                        <p className="text-xs md:text-sm text-gray-500 mt-1 leading-relaxed">
                                            The phlebotomist arrives at your selected address during the booked time slot with sterile, single-use barcoded sample kits.
                                        </p>
                                    </div>
                                </div>

                                {/* Step 3 */}
                                <div className="flex items-start gap-4 relative">
                                    <div className="w-8 h-8 rounded-full bg-purple-100 text-primary text-xs font-black flex items-center justify-center shrink-0 border border-purple-200 z-10">
                                        3
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-bold text-gray-900">Digital Lab Reports (24-48h)</h3>
                                        <p className="text-xs md:text-sm text-gray-500 mt-1 leading-relaxed">
                                            Samples are processed at NABL/CAP-accredited laboratories. Verified PDF reports will be sent directly to your phone and available in your DOCNOW dashboard.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </Card>}

                        {/* Order Details Preview (if available) */}
                        {bookingDetails && (
                            <Card className="p-6 bg-white border border-gray-100 shadow-sm">
                                <h3 className="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
                                    <FlaskConical className="w-4 h-4 text-primary" />
                                    Appointment Details
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                                    {bookingDetails.slotDate && (
                                        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-gray-50 border border-gray-100">
                                            <Calendar className="w-4 h-4 text-gray-400 mt-0.5" />
                                            <div>
                                                <span className="text-xs text-gray-400 font-semibold block">Date</span>
                                                <span className="font-bold text-gray-800">{bookingDetails.slotDate}</span>
                                            </div>
                                        </div>
                                    )}
                                    {bookingDetails.slotTime && (
                                        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-gray-50 border border-gray-100">
                                            <Clock className="w-4 h-4 text-gray-400 mt-0.5" />
                                            <div>
                                                <span className="text-xs text-gray-400 font-semibold block">Time Slot</span>
                                                <span className="font-bold text-gray-800">{bookingDetails.slotTime}</span>
                                            </div>
                                        </div>
                                    )}
                                    {bookingDetails.address && (
                                        <div className="sm:col-span-2 flex items-start gap-2.5 p-3 rounded-xl bg-gray-50 border border-gray-100">
                                            <MapPin className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                                            <div>
                                                <span className="text-xs text-gray-400 font-semibold block">Collection Address</span>
                                                <span className="font-medium text-gray-800">
                                                    {bookingDetails.address.line1}, {bookingDetails.address.city} - {bookingDetails.address.pincode}
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </Card>
                        )}
                    </div>

                    {/* Right Column: Actions & Trust (Span 1) */}
                    <div className="space-y-6">
                        {/* Primary Action Card */}
                        <Card className="p-6 bg-white border border-gray-100 shadow-sm flex flex-col justify-between">
                            <div>
                                <h3 className="text-base font-black text-gray-900 mb-2">
                                    Manage Your Booking
                                </h3>
                                <p className="text-xs md:text-sm text-gray-500 mb-6 leading-relaxed">
                                    Track phlebotomist arrival, view reports, or download your tax invoice anytime from your account dashboard.
                                </p>
                            </div>

                            <div className="space-y-3">
                                <Link href="/profile?tab=bookings" className="block w-full">
                                    <Button className="w-full py-3 gap-2 flex items-center justify-center group shadow-md shadow-primary/25">
                                        <span>View My Bookings</span>
                                        <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                                    </Button>
                                </Link>

                                <Link href="/search" className="block w-full">
                                    <Button variant="outline" className="w-full py-3 gap-2 flex items-center justify-center">
                                        <ShoppingBag className="w-4 h-4 text-gray-500" />
                                        <span>Book More Tests</span>
                                    </Button>
                                </Link>
                            </div>
                        </Card>

                        {/* Trust & Accreditations Badge */}
                        <Card className="p-6 bg-purple-50/60 border border-purple-100/80 shadow-sm">
                            <h4 className="text-xs font-black uppercase tracking-wider text-purple-900 mb-4 flex items-center gap-1.5">
                                <Award className="w-4 h-4 text-primary" />
                                DOCNOW Quality Guarantee
                            </h4>

                            <ul className="space-y-3 text-xs font-medium text-purple-950">
                                <li className="flex items-center gap-2">
                                    <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                                    <span>NABL & CAP Accredited Laboratory Processing</span>
                                </li>
                                <li className="flex items-center gap-2">
                                    <Lock className="w-4 h-4 text-emerald-600 shrink-0" />
                                    <span>100% Confidential & Secure Health Records</span>
                                </li>
                                <li className="flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-emerald-600 shrink-0" />
                                    <span>Smart Doctor-Verified Digital Reports</span>
                                </li>
                            </ul>
                        </Card>

                        {/* Direct Support */}
                        <div className="p-4 rounded-2xl bg-gray-50 border border-gray-100 text-center">
                            <p className="text-xs text-gray-500 mb-2">Need help or want to modify your appointment?</p>
                            <Link
                                href="/contact"
                                className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
                            >
                                <Phone className="w-3.5 h-3.5" />
                                Contact DocNow Support
                            </Link>
                        </div>
                    </div>
                </div>
            </div>

            {/* Reusable Global Footer */}
            <Footer />
        </main>
    );
}
