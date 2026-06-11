import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';

const DONE_BOOKING_STATUSES = new Set(['Report Generated', 'Completed']);
const DONE_PARTNER_STATUSES = new Set(['BS008', 'BS015']);
const BOUNCED_BOOKING_STATUSES = new Set(['Cancelled', 'CANCELLED', 'BOOKING_FAILED', 'Refunded']);
const BOUNCED_PAYMENT_STATUSES = new Set(['FAILED', 'PARTNER_FAILED', 'CANCELLED', 'REFUNDED', 'EXPIRED']);
const COLLECTED_PAYMENT_STATUSES = new Set(['CONFIRMED', 'PAID']);

export interface SalesReportRow {
    date: string;
    totalTestsBooked: number;
    totalTestsDone: number;
    testsBounced: number;
    revenueCollected: number;
    averageOrderValue: number;
    totalPatients: number;
    repeatPatients: number;
    newPatients: number;
}

function parseIstDateStart(date: string) {
    const [year, month, day] = date.split('-').map(Number);
    if (!year || !month || !day) return null;
    return new Date(Date.UTC(year, month - 1, day, -5, -30, 0, 0));
}

function parseIstDateEnd(date: string) {
    const start = parseIstDateStart(date);
    if (!start) return null;
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return end;
}

function formatIstDate(date: Date) {
    const ist = new Date(date.getTime() + 330 * 60 * 1000);
    return ist.toISOString().slice(0, 10);
}

function roundMoney(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isDoneBooking(booking: { status: string; partnerStatus?: string | null }) {
    return DONE_BOOKING_STATUSES.has(booking.status) || Boolean(booking.partnerStatus && DONE_PARTNER_STATUSES.has(booking.partnerStatus));
}

function isBouncedBooking(booking: { status: string; paymentStatus: string }) {
    return BOUNCED_BOOKING_STATUSES.has(booking.status) || BOUNCED_PAYMENT_STATUSES.has(booking.paymentStatus);
}

function csvValue(value: string | number) {
    const text = String(value ?? '');
    if (/[",\n\r]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

export function salesReportRowsToCsv(rows: SalesReportRow[]) {
    const headers = [
        'date',
        'total tests booked',
        'total tests done',
        'tests bounced',
        'revenue collected',
        'average order value',
        'total patients',
        'repeat patients',
        'new patients',
    ];

    const csvRows = rows.map((row) => [
        row.date,
        row.totalTestsBooked,
        row.totalTestsDone,
        row.testsBounced,
        row.revenueCollected,
        row.averageOrderValue,
        row.totalPatients,
        row.repeatPatients,
        row.newPatients,
    ].map(csvValue).join(','));

    return '\uFEFF' + [headers.join(','), ...csvRows].join('\n');
}

export async function buildSalesReportRows(query: AuthRequest['query']): Promise<SalesReportRow[]> {
    const dateFrom = query.dateFrom as string | undefined;
    const dateTo = query.dateTo as string | undefined;
    const city = (query.city as string | undefined)?.trim();
    const limitToAnalyze = 10000;

    const where: any = {};
    if (dateFrom || dateTo) {
        where.createdAt = {};
        if (dateFrom) {
            const start = parseIstDateStart(dateFrom);
            if (start) where.createdAt.gte = start;
        }
        if (dateTo) {
            const end = parseIstDateEnd(dateTo);
            if (end) where.createdAt.lt = end;
        }
    }

    if (city) {
        where.OR = [
            { addressCity: { contains: city, mode: 'insensitive' } },
            { address: { city: { contains: city, mode: 'insensitive' } } },
        ];
    }

    const bookings = await prisma.booking.findMany({
        where,
        take: limitToAnalyze,
        orderBy: { createdAt: 'asc' },
        include: {
            items: { select: { id: true, patientId: true } },
        },
    });

    const patientIds = Array.from(new Set(bookings.flatMap((booking) => booking.items.map((item) => item.patientId))));
    const firstSeenByPatient = new Map<string, Date>();

    if (patientIds.length > 0) {
        const patientItems = await prisma.bookingItem.findMany({
            where: { patientId: { in: patientIds } },
            select: {
                patientId: true,
                booking: { select: { createdAt: true } },
            },
        });

        for (const item of patientItems) {
            const existing = firstSeenByPatient.get(item.patientId);
            if (!existing || item.booking.createdAt < existing) {
                firstSeenByPatient.set(item.patientId, item.booking.createdAt);
            }
        }
    }

    type MutableRow = Omit<SalesReportRow, 'averageOrderValue' | 'totalPatients' | 'repeatPatients' | 'newPatients'> & {
        revenueBookingCount: number;
        patients: Set<string>;
        newPatientIds: Set<string>;
        repeatPatientIds: Set<string>;
    };

    const rowMap = new Map<string, MutableRow>();

    for (const booking of bookings) {
        const date = formatIstDate(booking.createdAt);
        const key = date;
        const row = rowMap.get(key) || {
            date,
            totalTestsBooked: 0,
            totalTestsDone: 0,
            testsBounced: 0,
            revenueCollected: 0,
            revenueBookingCount: 0,
            patients: new Set<string>(),
            newPatientIds: new Set<string>(),
            repeatPatientIds: new Set<string>(),
        };

        const testCount = booking.items.length;
        row.totalTestsBooked += testCount;

        if (isDoneBooking(booking)) {
            row.totalTestsDone += testCount;
        }

        if (isBouncedBooking(booking)) {
            row.testsBounced += testCount;
        }

        if (COLLECTED_PAYMENT_STATUSES.has(booking.paymentStatus)) {
            row.revenueCollected += booking.finalAmount || booking.totalAmount || 0;
            row.revenueBookingCount += 1;
        }

        for (const item of booking.items) {
            row.patients.add(item.patientId);
            const firstSeen = firstSeenByPatient.get(item.patientId);
            if (firstSeen && formatIstDate(firstSeen) === date) {
                row.newPatientIds.add(item.patientId);
            } else {
                row.repeatPatientIds.add(item.patientId);
            }
        }

        rowMap.set(key, row);
    }

    return Array.from(rowMap.values())
        .map((row) => {
            const newPatients = row.newPatientIds.size;
            const totalPatients = row.patients.size;
            return {
                date: row.date,
                totalTestsBooked: row.totalTestsBooked,
                totalTestsDone: row.totalTestsDone,
                testsBounced: row.testsBounced,
                revenueCollected: roundMoney(row.revenueCollected),
                averageOrderValue: row.revenueBookingCount > 0 ? roundMoney(row.revenueCollected / row.revenueBookingCount) : 0,
                totalPatients,
                repeatPatients: Math.max(totalPatients - newPatients, 0),
                newPatients,
            };
        })
        .sort((a, b) => b.date.localeCompare(a.date));
}

export async function getSalesReport(req: AuthRequest, res: Response) {
    try {
        const rows = await buildSalesReportRows(req.query);
        res.json({
            rows,
            total: rows.length,
        });
    } catch (error) {
        console.error('[Admin] Error building sales report:', error);
        res.status(500).json({ error: 'Failed to build sales report' });
    }
}
