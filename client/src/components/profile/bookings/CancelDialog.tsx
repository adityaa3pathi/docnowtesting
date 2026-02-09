
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button, Input } from '@/components/ui';

interface CancelDialogProps {
    bookingId: string | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
}

export function CancelDialog({ bookingId, open, onOpenChange, onSuccess }: CancelDialogProps) {
    const [cancelReason, setCancelReason] = useState('');
    const [isCancelling, setIsCancelling] = useState(false);

    const handleCancelBooking = async () => {
        if (!bookingId || cancelReason.length < 5) return;

        setIsCancelling(true);
        try {
            await api.post(`/bookings/${bookingId}/cancel`, { remarks: cancelReason });
            setCancelReason('');
            onSuccess();
            onOpenChange(false);
            alert('Booking cancelled successfully');
        } catch (error: any) {
            console.error('Error cancelling booking:', error);
            alert(error.response?.data?.error || 'Failed to cancel booking');
        } finally {
            setIsCancelling(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Cancel Booking</DialogTitle>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    <p className="text-sm text-gray-500">
                        Are you sure you want to cancel this booking? This action cannot be undone.
                    </p>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Reason for Cancellation</label>
                        <Input
                            placeholder="Please provide a reason (min 5 characters)..."
                            value={cancelReason}
                            onChange={(e) => setCancelReason(e.target.value)}
                            className="w-full"
                        />
                    </div>
                </div>
                <div className="flex justify-end gap-3">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Keep Booking
                    </Button>
                    <Button
                        variant="outline"
                        onClick={handleCancelBooking}
                        disabled={isCancelling || cancelReason.length < 5}
                        className="bg-red-600 hover:bg-red-700 text-white hover:text-white"
                    >
                        {isCancelling ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                        Confirm Cancellation
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
