
"use client";

import { useState } from 'react';
import { Calendar, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { useBookings } from './bookings/useBookings';
import { BookingCard } from './bookings/BookingCard';
import { BookingHeader } from './bookings/types';
import { TrackStatusDialog } from './bookings/TrackStatusDialog';
import { CancelDialog } from './bookings/CancelDialog';
import { RescheduleDialog } from './bookings/RescheduleDialog';

export function BookingsTab() {
    const { bookings, loading, fetchBookings } = useBookings();

    // Dialog States
    const [trackingId, setTrackingId] = useState<string | null>(null);
    const [statusDialogOpen, setStatusDialogOpen] = useState(false);

    const [bookingToCancel, setBookingToCancel] = useState<string | null>(null);
    const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

    const [bookingToReschedule, setBookingToReschedule] = useState<BookingHeader | null>(null);
    const [rescheduleDialogOpen, setRescheduleDialogOpen] = useState(false);

    const handleTrackStatus = (id: string) => {
        setTrackingId(id);
        setStatusDialogOpen(true);
    };

    const handleCancel = (id: string) => {
        setBookingToCancel(id);
        setCancelDialogOpen(true);
    };

    const handleReschedule = (booking: BookingHeader) => {
        setBookingToReschedule(booking);
        setRescheduleDialogOpen(true);
    };

    if (loading) return <div className="flex justify-center py-12"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="space-y-6">
            <h2 className="text-xl font-bold mb-6">My Bookings</h2>

            {bookings.length === 0 ? (
                <div className="text-center py-16 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                    <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900">No bookings found</h3>
                    <p className="text-gray-500 mb-6">You haven't made any appointments yet.</p>
                    <Button onClick={() => window.location.href = '/search'}>Book Now</Button>
                </div>
            ) : (
                <div className="space-y-4">
                    {bookings.map((booking) => (
                        <BookingCard
                            key={booking.id}
                            booking={booking}
                            onTrack={handleTrackStatus}
                            onReschedule={handleReschedule}
                            onCancel={handleCancel}
                        />
                    ))}
                </div>
            )}

            {/* Dialogs */}
            <TrackStatusDialog
                open={statusDialogOpen}
                onOpenChange={setStatusDialogOpen}
                bookingId={trackingId}
                onStatusUpdate={fetchBookings}
            />

            <CancelDialog
                open={cancelDialogOpen}
                onOpenChange={setCancelDialogOpen}
                bookingId={bookingToCancel}
                onSuccess={fetchBookings}
            />

            <RescheduleDialog
                open={rescheduleDialogOpen}
                onOpenChange={setRescheduleDialogOpen}
                booking={bookingToReschedule}
                onSuccess={fetchBookings}
            />
        </div>
    );
}
