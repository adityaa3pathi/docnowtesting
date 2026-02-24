import { useState, useEffect } from 'react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { Address, SlotItem } from '@/types/cart';

export function useSlots(selectedAddress: Address | undefined, selectedDate: string) {
    const [slots, setSlots] = useState<SlotItem[]>([]);
    const [selectedTime, setSelectedTime] = useState<string>('');
    const [loadingSlots, setLoadingSlots] = useState(false);
    const [freezingSlot, setFreezingSlot] = useState(false);
    const [isSlotLocked, setIsSlotLocked] = useState(false);

    useEffect(() => {
        if (selectedAddress) {
            fetchSlots(selectedAddress, selectedDate);
        } else {
            setSlots([]);
            setSelectedTime('');
        }
    }, [selectedAddress?.id, selectedDate]);

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
            toast.success('Slot Locked Successfully!');
            setIsSlotLocked(true);
        } catch (error) {
            console.error('Error freezing slot:', error);
            toast.error('Failed to lock this slot. Please try another one.');
            setIsSlotLocked(false);
        } finally {
            setFreezingSlot(false);
        }
    };

    const onDateSelect = (date: string) => {
        if (date !== selectedDate) {
            // This needs to be handled by the caller to update selectedDate
            setSelectedTime('');
            setIsSlotLocked(false);
        }
    };

    const onTimeSelect = (time: string) => {
        setSelectedTime(time);
        setIsSlotLocked(false);
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
        onTimeSelect
    };
}
