import { useState, useEffect, useRef, useCallback } from 'react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { Address, SlotItem } from '@/types/cart';

const FREEZE_DURATION_MS = 15 * 60 * 1000; // 15 minutes (Healthians API)
const AUTO_REFREEZE_AT_MS = 3 * 60 * 1000; // Re-freeze when 3 minutes remain
const WARNING_AT_SECONDS = 5 * 60; // Show yellow warning at 5 min
const URGENT_AT_SECONDS = 2 * 60; // Show red warning at 2 min

export function useSlots(selectedAddress: Address | undefined, selectedDate: string) {
    const [slots, setSlots] = useState<SlotItem[]>([]);
    const [selectedTime, setSelectedTime] = useState<string>('');
    const [loadingSlots, setLoadingSlots] = useState(false);
    const [freezingSlot, setFreezingSlot] = useState(false);
    const [isSlotLocked, setIsSlotLocked] = useState(false);

    // Timer state
    const [freezeExpiresAt, setFreezeExpiresAt] = useState<number | null>(null);
    const [secondsRemaining, setSecondsRemaining] = useState<number>(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const autoRefreezeRef = useRef(false); // prevents double re-freeze

    // Cleanup timer on unmount
    useEffect(() => {
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, []);

    // Countdown ticker
    useEffect(() => {
        if (!freezeExpiresAt || !isSlotLocked) {
            setSecondsRemaining(0);
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            return;
        }

        const tick = () => {
            const now = Date.now();
            const remaining = Math.max(0, Math.floor((freezeExpiresAt - now) / 1000));
            setSecondsRemaining(remaining);

            // Auto re-freeze at 3 minutes remaining
            if (remaining * 1000 <= AUTO_REFREEZE_AT_MS && remaining > 0 && !autoRefreezeRef.current) {
                autoRefreezeRef.current = true;
                silentRefreeze();
            }

            // Slot expired
            if (remaining <= 0) {
                handleSlotExpired();
            }
        };

        tick(); // Run immediately
        timerRef.current = setInterval(tick, 1000);

        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [freezeExpiresAt, isSlotLocked]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSlotExpired = useCallback(() => {
        if (timerRef.current) clearInterval(timerRef.current);
        setIsSlotLocked(false);
        setFreezeExpiresAt(null);
        setSecondsRemaining(0);
        autoRefreezeRef.current = false;
        toast.error('Slot reservation expired. Please lock the slot again.', { duration: 5000 });
    }, []);

    const silentRefreeze = useCallback(async () => {
        if (!selectedAddress || !selectedDate || !selectedTime) return;

        const slot = slots.find(s => s.slot_time === selectedTime);
        if (!slot?.stm_id) return;

        try {
            await api.post('/slots/freeze', { slot_id: slot.stm_id });
            const newExpiry = Date.now() + FREEZE_DURATION_MS;
            setFreezeExpiresAt(newExpiry);
            autoRefreezeRef.current = false; // Reset for next cycle
        } catch {
            // Silent failure — the original timer will continue counting down
            console.warn('[useSlots] Auto re-freeze failed');
        }
    }, [selectedAddress, selectedDate, selectedTime, slots]);

    // Reset everything when address or date changes
    useEffect(() => {
        if (selectedAddress) {
            fetchSlots(selectedAddress, selectedDate);
        } else {
            setSlots([]);
            setSelectedTime('');
        }
        // Reset freeze state on address/date change
        resetFreeze();
    }, [selectedAddress?.id, selectedDate]); // eslint-disable-line react-hooks/exhaustive-deps

    const resetFreeze = () => {
        setIsSlotLocked(false);
        setFreezeExpiresAt(null);
        setSecondsRemaining(0);
        autoRefreezeRef.current = false;
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    };

    const fetchSlots = async (address: Address, date: string) => {
        try {
            setLoadingSlots(true);
            setSlots([]);

            let finalLat = address.lat;
            let finalLong = address.long;

            if (!finalLat || !finalLong) {
                try {
                    const geoRes = await api.get('/location/geocode', { params: { pincode: address.pincode } });
                    if (geoRes.data && geoRes.data.lat) {
                        finalLat = geoRes.data.lat;
                        finalLong = geoRes.data.long;
                        // Save geocoded coords back to address so server has them for booking
                        api.patch(`/profile/addresses/${address.id}/coords`, {
                            lat: finalLat, long: finalLong
                        }).catch(() => {});
                    }
                } catch (err) {
                    console.error('In-cart geocoding failed:', err);
                }
            }

            const res = await api.get('/slots', {
                params: {
                    lat: finalLat || '28.6139',
                    long: finalLong || '77.2090',
                    zipcode: address.pincode,
                    date: date
                }
            });

            let slotsArray: any[] = [];
            if (res.data.data && Array.isArray(res.data.data)) {
                slotsArray = res.data.data;
            } else if (res.data.slots && Array.isArray(res.data.slots)) {
                slotsArray = res.data.slots;
            }

            if (slotsArray.length > 0) {
                const validSlots = slotsArray.filter((s: SlotItem) => s.slot_time);
                setSlots(validSlots);
            } else {
                setSlots([]);
            }
        } catch (error) {
            console.error('Error fetching slots:', error);
            setSlots([]);
        } finally {
            setLoadingSlots(false);
        }
    };

    const handleFreezeSlot = async () => {
        if (!selectedAddress || !selectedDate || !selectedTime) return;

        const slot = slots.find(s => s.slot_time === selectedTime);
        if (!slot) {
            toast.error('Error: Selected slot data is missing. Please refresh.');
            return;
        }

        const slotId = slot.stm_id;
        if (!slotId) {
            toast.error('Error: Invalid slot data.');
            return;
        }

        try {
            setFreezingSlot(true);
            await api.post('/slots/freeze', { slot_id: slotId });
            toast.success('Slot locked! Complete your booking within 15 minutes.');
            setIsSlotLocked(true);
            setFreezeExpiresAt(Date.now() + FREEZE_DURATION_MS);
            autoRefreezeRef.current = false;
        } catch (error) {
            console.error('Error freezing slot:', error);
            toast.error('Failed to lock this slot. Please try another one.');
            setIsSlotLocked(false);
            setFreezeExpiresAt(null);
        } finally {
            setFreezingSlot(false);
        }
    };

    const onTimeSelect = (time: string) => {
        setSelectedTime(time);
        resetFreeze();
    };

    return {
        slots,
        selectedTime,
        setSelectedTime,
        loadingSlots,
        freezingSlot,
        isSlotLocked,
        setIsSlotLocked,
        handleFreezeSlot,
        onTimeSelect,
        // Timer exports
        secondsRemaining,
        freezeExpiresAt,
        WARNING_AT_SECONDS,
        URGENT_AT_SECONDS
    };
}
