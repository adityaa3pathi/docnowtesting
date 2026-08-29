'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
    CheckCircle2,
    Calendar,
    Clock,
    MapPin,
    Copy,
    Check,
    ArrowRight,
    ShieldCheck,
    FileText,
    Sparkles,
    Phone,
    ShoppingBag,
    Award,
    Lock,
    Truck,
    FlaskConical
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import { Button, Card } from '@/components/ui';
import { Footer } from '@/components/Footer';
import api from '@/lib/api';

interface BookingStatusData {
    status?: string;
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

    const [copied, setCopied] = useState(false);
    const [bookingDetails, setBookingDetails] = useState<BookingStatusData | null>(null);
    const [loadingDetails, setLoadingDetails] = useState(false);

    // Fetch booking summary if bookingId is present and user is authenticated
    useEffect(() => {
        if (!bookingId) return;

        let isMounted = true;
        const fetchStatus = async () => {
            try {
                setLoadingDetails(true);
                const res = await api.get(`/bookings/${bookingId}/status`);
                if (isMounted && res.data) {
                    setBookingDetails(res.data);
                }
            } catch (err) {
                // If status API is not available or non-critical error, silently proceed with URL params
                console.log('[ThankYou] Could not fetch detailed booking info:', err);
            } finally {
                if (isMounted) {
                    setLoadingDetails(false);
                }
            }
        };

        if (isAuthenticated) {
            fetchStatus();
        }

        return () => {
            isMounted = false;
        };
    }, [bookingId, isAuthenticated]);

    const handleCopyBookingId = async () => {
        if (!bookingId) return;
        try {
            await navigator.clipboard.writeText(bookingId);
            setCopied(true);
            toast.success('Booking ID copied to clipboard!');
            setTimeout(() => setCopied(false), 2500);
        } catch {
            toast.error('Failed to copy ID');
        }
    };

    const isPending = queryStatus === 'pending' || bookingDetails?.status === 'payment_received_booking_pending';

    return (
        <main
            className="min-h-screen bg-gradient-to-b from-purple-50/40 via-white to-gray-50/50 flex flex-col justify-between"
            data-page-type="thank-you"
            data-booking-id={bookingId}
            data-order-status={isPending ? 'PENDING' : 'CONFIRMED'}
        >
            <div className="container mx-auto px-4 py-8 md:py-14 max-w-4xl flex-grow">
                {/* ═══════════ HERO BANNER ═══════════ */}
                <div className="text-center mb-8 md:mb-12">
                    {/* Animated Checkmark / Success Icon */}
                    <div className="inline-flex items-center justify-center relative mb-5">
                        <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-400 p-0.5 shadow-xl shadow-emerald-500/20 flex items-center justify-center animate-in zoom-in-75 duration-300">
                            <div className="w-full h-full bg-emerald-500 rounded-full flex items-center justify-center text-white">
                                <CheckCircle2 className="w-10 h-10 md:w-12 md:h-12 stroke-[2.5]" />
                            </div>
                        </div>
                        <div className="absolute -top-1 -right-1 bg-purple-600 text-white rounded-full p-1.5 shadow-md">
                            <Sparkles className="w-4 h-4" />
                        </div>
                    </div>

                    <h1 className="text-3xl md:text-5xl font-black text-gray-900 tracking-tight mb-3">
                        {isPending ? 'Payment Received!' : 'Order Confirmed!'}
                    </h1>

                    <p className="text-base md:text-lg text-gray-600 font-medium max-w-xl mx-auto mb-6">
                        {isPending
                            ? 'Your payment was successful! Our lab partner is finalizing your slot assignment.'
                            : `Thank you${user?.name ? `, ${user.name}` : ''}! Your health test booking has been successfully placed.`}
                    </p>

                    {/* Booking Reference Pill */}
                    {bookingId ? (
                        <div className="inline-flex flex-wrap items-center justify-center gap-2 md:gap-3 px-4 py-2.5 rounded-2xl bg-white border border-gray-200 shadow-sm">
                            <span className="text-xs md:text-sm font-semibold text-gray-500">Booking Reference:</span>
                            <span className="text-xs md:text-sm font-mono font-bold text-primary bg-purple-50 px-2.5 py-1 rounded-lg border border-purple-100/60">
                                {bookingId}
                            </span>
                            <button
                                onClick={handleCopyBookingId}
                                aria-label="Copy booking reference ID"
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-gray-600 hover:text-primary hover:bg-purple-50 transition-colors"
                            >
                                {copied ? (
                                    <>
                                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                                        <span className="text-emerald-600">Copied</span>
                                    </>
                                ) : (
                                    <>
                                        <Copy className="w-3.5 h-3.5" />
                                        <span>Copy</span>
                                    </>
                                )}
                            </button>
                        </div>
                    ) : null}
                </div>

                {/* ═══════════ MAIN CONTENT GRID ═══════════ */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                    {/* Left & Middle Column (Span 2) */}
                    <div className="md:col-span-2 space-y-6">
                        {/* What Happens Next Card */}
                        <Card className="p-6 md:p-8 bg-white border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
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
                        </Card>

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
