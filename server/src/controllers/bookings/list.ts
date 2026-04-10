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

        // Map to DTO
        const sanitizedBookings = bookings.map(b => ({
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
            rescheduledToId: b.rescheduledToId,
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
        }));

        res.json(sanitizedBookings);
    } catch (error) {
        console.error('List Bookings Error:', error);
        res.status(500).json({ error: 'Failed to list bookings' });
    }
}
