
import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { BookingHeader } from './types';

export function useBookings() {
    const [bookings, setBookings] = useState<BookingHeader[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchBookings();
    }, []);

    const fetchBookings = async () => {
        try {
            const res = await api.get('/bookings');
            setBookings(res.data);
        } catch (error) {
            console.error('Error fetching bookings:', error);
        } finally {
            setLoading(false);
        }
    };

    return { bookings, loading, fetchBookings };
}
