import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';

/**
 * GET /api/bookings - List User Bookings
 */
export async function listBookings(req: AuthRequest, res: Response) {
    try {
        const userId = req.userId!;

        const bookings = await prisma.booking.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            include: {
                items: true,
                reports: {
                    select: {
                        id: true,
                        isFullReport: true,
                        fetchStatus: true,
                        verifiedAt: true,
                        fileSize: true,
                        generatedAt: true,
                    },
                    orderBy: { generatedAt: 'desc' },
                },
            }
        });

        // Fetch reschedule context for rescheduled bookings
        const rescheduledIds = bookings
            .filter(b => b.status === 'Rescheduled' && b.rescheduledToId)
            .map(b => b.rescheduledToId!);
        const newBookingsMap = new Map<string, { slotDate: string, slotTime: string }>();
        if (rescheduledIds.length > 0) {
            const newBookings = await prisma.booking.findMany({
                where: { id: { in: rescheduledIds } },
                select: { id: true, slotDate: true, slotTime: true }
            });
            newBookings.forEach(nb => newBookingsMap.set(nb.id, { slotDate: nb.slotDate, slotTime: nb.slotTime }));
        }

        const bookingIds = bookings.map(b => b.id);
        const rescheduleAudits = bookingIds.length > 0
            ? await prisma.adminAuditLog.findMany({
                where: {
                    action: 'MANAGER_BOOKING_RESCHEDULED',
                    entity: 'Booking',
                    targetId: { in: bookingIds },
                },
                orderBy: { createdAt: 'desc' },
            })
            : [];
        const rescheduleAuditMap = new Map<string, { by: string, at: Date }>();
        rescheduleAudits.forEach(log => {
            if (log.targetId && !rescheduleAuditMap.has(log.targetId)) {
                rescheduleAuditMap.set(log.targetId, { by: log.adminName || 'Manager', at: log.createdAt });
            }
        });

        // Map to DTO
        const sanitizedBookings = bookings.map(b => {
            let rescheduleInfo = null;
            if (b.status === 'Rescheduled' && b.rescheduledToId) {
                const newSlot = newBookingsMap.get(b.rescheduledToId);
                const audit = rescheduleAuditMap.get(b.id);
                rescheduleInfo = {
                    newBookingId: b.rescheduledToId,
                    newSlotDate: newSlot?.slotDate || null,
                    newSlotTime: newSlot?.slotTime || null,
                    rescheduledBy: audit?.by || 'You',
                    rescheduledAt: audit?.at || null,
                };
            }

            return {
            currentPartnerBookingId: b.rescheduledToId || b.partnerBookingId,
            previousPartnerBookingIds:
                b.rescheduledToId && b.partnerBookingId && b.rescheduledToId !== b.partnerBookingId
                    ? [b.partnerBookingId]
                    : [],
            trackingReferenceUpdated:
                Boolean(b.rescheduledToId && b.partnerBookingId && b.rescheduledToId !== b.partnerBookingId),
            bookingChangeType:
                b.status === 'Resample Required' || ['BS0018', 'BS018'].includes(b.partnerStatus || '')
                    ? 'RESAMPLED'
                    : b.status === 'Rescheduled' || b.partnerStatus === 'BS0013'
                        ? 'RESCHEDULED'
                        : 'NONE',
            bookingChangeMessage:
                b.status === 'Resample Required' || ['BS0018', 'BS018'].includes(b.partnerStatus || '')
                    ? 'The lab has asked for a fresh sample collection. We will guide you through the next step.'
                    : b.status === 'Rescheduled' && !(b.rescheduledToId && b.partnerBookingId && b.rescheduledToId !== b.partnerBookingId)
                        ? 'This booking has been replaced by a newer booking reference.'
                        : b.partnerStatus === 'BS0013' || (b.rescheduledToId && b.partnerBookingId && b.rescheduledToId !== b.partnerBookingId)
                            ? 'We have updated your booking with the latest schedule from our lab partner.'
                            : null,
            superseded: b.status === 'Rescheduled' && !(b.rescheduledToId && b.partnerBookingId && b.rescheduledToId !== b.partnerBookingId),
            id: b.id,
            partnerBookingId: b.partnerBookingId,
            partnerStatus: b.partnerStatus,
            status: b.status,
            paymentStatus: b.paymentStatus,
            slotDate: b.slotDate,
            slotTime: b.slotTime,
            totalAmount: b.totalAmount,
            createdAt: b.createdAt,
            invoiceAvailable: b.paymentStatus === 'CONFIRMED',
            rescheduledToId: b.rescheduledToId,
            rescheduleInfo,
            items: b.items.map(i => i.testName),
            address: b.addressLine ? {
                line1: b.addressLine,
                city: b.addressCity,
                pincode: b.addressPincode,
                lat: b.addressLat,
                long: b.addressLong
            } : null,
            reports: b.reports.map(r => ({
                id: r.id,
                isFullReport: r.isFullReport,
                fetchStatus: r.fetchStatus,
                verifiedAt: r.verifiedAt,
                fileSize: r.fileSize,
                generatedAt: r.generatedAt,
            })),
        }});

        res.json(sanitizedBookings);
    } catch (error) {
        console.error('List Bookings Error:', error);
        res.status(500).json({ error: 'Failed to list bookings' });
    }
}
