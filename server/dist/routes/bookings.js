"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const bookings_1 = require("../controllers/bookings");
const router = (0, express_1.Router)();
console.log('Bookings Router Loaded');
// POST /api/bookings - Create Booking
router.post('/', auth_1.authMiddleware, bookings_1.createBooking);
// GET /api/bookings - List User Bookings
router.get('/', auth_1.authMiddleware, bookings_1.listBookings);
// GET /api/bookings/:id/status - Track Status
router.get('/:id/status', auth_1.authMiddleware, bookings_1.getStatus);
// POST /api/bookings/:id/cancel - Cancel Booking
router.post('/:id/cancel', auth_1.authMiddleware, bookings_1.cancelBooking);
// POST /api/bookings/:id/reschedule - Reschedule Booking
router.post('/:id/reschedule', auth_1.authMiddleware, bookings_1.rescheduleBooking);
// GET /api/bookings/:id/reschedulable-slots - Fetch slots for rescheduling
router.get('/:id/reschedulable-slots', auth_1.authMiddleware, bookings_1.getReschedulableSlots);
// GET /api/bookings/:id/phlebo-contact - Get assigned phlebotomist contact
router.get('/:id/phlebo-contact', auth_1.authMiddleware, bookings_1.getPhleboContact);
exports.default = router;
