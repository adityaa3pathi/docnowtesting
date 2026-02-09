import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
    createBooking,
    listBookings,
    getStatus,
    cancelBooking,
    rescheduleBooking,
    getReschedulableSlots,
    getPhleboContact
} from '../controllers/bookings';

const router = Router();

console.log('Bookings Router Loaded');

// POST /api/bookings - Create Booking
router.post('/', authMiddleware, createBooking);

// GET /api/bookings - List User Bookings
router.get('/', authMiddleware, listBookings);

// GET /api/bookings/:id/status - Track Status
router.get('/:id/status', authMiddleware, getStatus);

// POST /api/bookings/:id/cancel - Cancel Booking
router.post('/:id/cancel', authMiddleware, cancelBooking);

// POST /api/bookings/:id/reschedule - Reschedule Booking
router.post('/:id/reschedule', authMiddleware, rescheduleBooking);

// GET /api/bookings/:id/reschedulable-slots - Fetch slots for rescheduling
router.get('/:id/reschedulable-slots', authMiddleware, getReschedulableSlots);

// GET /api/bookings/:id/phlebo-contact - Get assigned phlebotomist contact
router.get('/:id/phlebo-contact', authMiddleware, getPhleboContact);

export default router;
