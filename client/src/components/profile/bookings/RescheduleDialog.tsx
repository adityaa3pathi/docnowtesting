
import { useState, useEffect } from 'react';
import { Calendar, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button, Input } from '@/components/ui';
import toast from 'react-hot-toast';
import { BookingHeader } from './types';

interface RescheduleDialogProps {
    booking: BookingHeader | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
}

export function RescheduleDialog({ booking, open, onOpenChange, onSuccess }: RescheduleDialogProps) {
    const [rescheduleDate, setRescheduleDate] = useState(new Date(Date.now() + 86400000).toISOString().split('T')[0]);
    const [availableSlots, setAvailableSlots] = useState<any[]>([]);
    const [slotsLoading, setSlotsLoading] = useState(false);
    const [selectedNewSlot, setSelectedNewSlot] = useState<any | null>(null);
    const [rescheduleReason, setRescheduleReason] = useState('');
    const [isRescheduling, setIsRescheduling] = useState(false);

    // Address selection for legacy bookings
    const [needsAddressSelection, setNeedsAddressSelection] = useState(false);
    const [availableAddresses, setAvailableAddresses] = useState<{ id: string, line1: string, city: string, pincode: string }[]>([]);
    const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);

    useEffect(() => {
        if (open && booking) {
            // Reset state on open
            setRescheduleDate(new Date(Date.now() + 86400000).toISOString().split('T')[0]);
            setRescheduleReason('');
            setSelectedNewSlot(null);
            setNeedsAddressSelection(false);
            setAvailableAddresses([]);
            setSelectedAddressId(null);

            // Initial fetch
            fetchRescheduleSlots(booking.id, new Date(Date.now() + 86400000).toISOString().split('T')[0], null);
        }
    }, [open, booking]);

    useEffect(() => {
        if (open && booking && (booking.addressId || selectedAddressId)) {
            fetchRescheduleSlots(booking.id, rescheduleDate, selectedAddressId);
        }
    }, [rescheduleDate, selectedAddressId]);

    const fetchRescheduleSlots = async (bookingId: string, date: string, addressId: string | null) => {
        setSlotsLoading(true);
        setAvailableSlots([]);
        try {
            const params: { date: string; addressId?: string } = { date };
            if (addressId) {
                params.addressId = addressId;
            }
            const res = await api.get(`/bookings/${bookingId}/reschedulable-slots`, { params });
            console.log('Reschedule slots API response:', res.data);

            const slots = res.data?.data?.slots || res.data?.slots || res.data?.data || [];
            if (Array.isArray(slots) && slots.length > 0) {
                setNeedsAddressSelection(false);
                setAvailableSlots(slots);
            } else {
                setAvailableSlots([]);
            }
        } catch (error: any) {
            console.error('Error fetching reschedule slots:', error);
            if (error.response?.data?.code === 'ADDRESS_REQUIRED') {
                setNeedsAddressSelection(true);
                setAvailableAddresses(error.response.data.addresses || []);
            } else {
                setAvailableSlots([]);
            }
        } finally {
            setSlotsLoading(false);
        }
    };

    const handleRescheduleBooking = async () => {
        if (!booking || !selectedNewSlot || rescheduleReason.length < 5) return;

        // Healthians uses stm_id as the slot identifier
        const slotId = selectedNewSlot.stm_id || selectedNewSlot.slot_id || selectedNewSlot.id;
        const startTime = selectedNewSlot.slot_time || selectedNewSlot.start_time || '';
        const endTime = selectedNewSlot.end_time || '';

        if (!slotId) {
            toast.error('Error: Could not determine slot ID. Please try selecting a different slot.');
            return;
        }

        setIsRescheduling(true);
        try {
            const res = await api.post(`/bookings/${booking.id}/reschedule`, {
                slot_id: slotId,
                slotDate: rescheduleDate,
                slotTime: `${startTime} - ${endTime}`,
                reschedule_reason: rescheduleReason
            });

            if (res.data.success) {
                onSuccess();
                onOpenChange(false);
                toast.success('Booking rescheduled successfully');
            }
        } catch (error: any) {
            console.error('Error rescheduling booking:', error);
            toast.error(error.response?.data?.error || 'Failed to reschedule booking');
        } finally {
            setIsRescheduling(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px] p-0 overflow-hidden border-none shadow-2xl rounded-3xl">
                <DialogHeader className="p-8 bg-gradient-to-br from-primary/5 to-secondary/5 border-b border-primary/10">
                    <DialogTitle className="text-2xl font-black text-slate-900 flex items-center gap-3">
                        <div className="bg-primary p-2 rounded-xl text-white shadow-lg shadow-primary/20">
                            <Calendar className="w-6 h-6" />
                        </div>
                        Reschedule Appointment
                    </DialogTitle>
                </DialogHeader>

                <div className="p-8 space-y-6">
                    <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 mb-4">
                        <p className="text-sm text-blue-700 font-medium leading-relaxed">
                            Pick a new date and time for your sample collection. We'll handle the rest!
                        </p>
                    </div>

                    {/* Date Picker */}
                    <div className="space-y-2">
                        <label className="text-xs font-black text-slate-400 uppercase tracking-widest px-1">Select New Date</label>
                        <Input
                            type="date"
                            min={new Date(Date.now() + 86400000).toISOString().split('T')[0]}
                            value={rescheduleDate}
                            onChange={(e) => setRescheduleDate(e.target.value)}
                            className="h-12 rounded-xl border-slate-200 focus:border-primary focus:ring-primary/20 transition-all font-bold"
                        />
                    </div>

                    {/* Address Selection (for legacy bookings) */}
                    {needsAddressSelection && (
                        <div className="space-y-2">
                            <label className="text-xs font-black text-slate-400 uppercase tracking-widest px-1">Select Address</label>
                            <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg border border-amber-100">This booking doesn't have a saved address. Please select one to view available slots.</p>
                            <div className="grid gap-2 max-h-[120px] overflow-y-auto pr-2">
                                {availableAddresses.map((addr) => (
                                    <button
                                        key={addr.id}
                                        onClick={() => setSelectedAddressId(addr.id)}
                                        className={`p-3 rounded-xl border-2 text-left transition-all ${selectedAddressId === addr.id
                                            ? 'border-primary bg-primary/5 text-primary'
                                            : 'border-slate-100 hover:border-primary/30 hover:bg-slate-50 text-slate-600'
                                            }`}
                                    >
                                        <span className="text-sm font-medium">{addr.line1}</span>
                                        <span className="text-xs text-slate-400 block">{addr.city} - {addr.pincode}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Slots */}
                    <div className="space-y-2">
                        <label className="text-xs font-black text-slate-400 uppercase tracking-widest px-1">Available Slots</label>
                        <div className="grid grid-cols-2 gap-3 max-h-[160px] overflow-y-auto pr-2 custom-scrollbar">
                            {slotsLoading ? (
                                <div className="col-span-2 py-8 flex items-center justify-center text-slate-400 text-sm font-medium italic">
                                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                                    Checking availability...
                                </div>
                            ) : availableSlots.length > 0 ? (
                                availableSlots.map((slot, idx) => {
                                    const slotId = slot.stm_id || slot.slot_id || slot.id || idx;
                                    const startTime = slot.slot_time || slot.start_time || 'N/A';
                                    const endTime = slot.end_time || '';
                                    return (
                                        <button
                                            key={slotId}
                                            type="button"
                                            onClick={() => setSelectedNewSlot(slot)}
                                            className={`p-3 rounded-xl border-2 transition-all flex flex-col items-center justify-center gap-1 cursor-pointer ${selectedNewSlot === slot || selectedNewSlot?.stm_id === slotId
                                                ? 'border-primary bg-primary/5 text-primary shadow-md shadow-primary/5'
                                                : 'border-slate-100 hover:border-primary/30 hover:bg-slate-50 text-slate-600'
                                                }`}
                                        >
                                            <span className="text-sm font-bold">{startTime}{endTime ? ` - ${endTime}` : ''}</span>
                                        </button>
                                    );
                                })
                            ) : (
                                <div className="col-span-2 py-8 text-center text-slate-400 text-sm font-medium italic border border-dashed border-slate-200 rounded-2xl">
                                    No slots available for this date.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Reason */}
                    <div className="space-y-2">
                        <label className="text-xs font-black text-slate-400 uppercase tracking-widest px-1">Reason for Rescheduling</label>
                        <Input
                            placeholder="Why are you rescheduling? (e.g., Change in plans)"
                            value={rescheduleReason}
                            onChange={(e) => setRescheduleReason(e.target.value)}
                            className="h-12 rounded-xl border-slate-200 focus:border-primary focus:ring-primary/20 transition-all font-medium"
                        />
                    </div>
                </div>

                <div className="p-8 bg-slate-50 flex items-center justify-end gap-3 border-t border-slate-100">
                    <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl px-6 font-bold h-11 border-slate-200 text-slate-600 hover:bg-white hover:text-slate-900 transition-all">
                        Keep Current
                    </Button>
                    <Button
                        onClick={handleRescheduleBooking}
                        disabled={isRescheduling || !selectedNewSlot || rescheduleReason.length < 5}
                        className={`rounded-xl px-8 font-black h-11 shadow-lg transition-all ${!selectedNewSlot || rescheduleReason.length < 5
                            ? 'bg-slate-300 shadow-none'
                            : 'bg-primary hover:bg-primary/90 shadow-primary/20 hover:scale-105 active:scale-95'
                            }`}
                    >
                        {isRescheduling ? (
                            <div className="flex items-center gap-2">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Updating...
                            </div>
                        ) : 'Reschedule Now'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
