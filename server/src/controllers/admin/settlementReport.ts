import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { SAMPLE_COLLECTION_FEE, SAMPLE_COLLECTION_FEE_THRESHOLD } from '../../utils/collectionFee';

export interface SettlementReportRow {
    sno: number;
    bookingDate: string;
    bookingTime: string;
    bookingId: string;
    city: string;
    billingCustomerName: string;
    patientsDetails: string;
    deliveryStatus: string;
    testNames: string;
    orderPrice: string;
    collectionCharges: number;
    totalOrderPrice: number;
    paidAmount: number;
    discount: number;
    promoCode: string;
    healthiansShare: number;
    docnowShare: number;
    collectionChargesPaid: number;
    walletAmount: number;
    paymentMode: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

function toIst(date: Date) {
    return new Date(date.getTime() + 330 * 60 * 1000);
}

function formatIstDate(date: Date) {
    const ist = toIst(date);
    const day = String(ist.getUTCDate()).padStart(2, '0');
    const month = MONTHS[ist.getUTCMonth()];
    const year = ist.getUTCFullYear();
    return `${day}-${month}-${year}`;
}

function formatIstTime(date: Date) {
    const ist = toIst(date);
    let hours = ist.getUTCHours();
    const minutes = String(ist.getUTCMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
}

function csvValue(value: string | number) {
    const text = String(value ?? '');
    if (/[",\n\r]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

export async function buildSettlementRows(query: AuthRequest['query']): Promise<SettlementReportRow[]> {
    const dateFrom = query.dateFrom as string | undefined;
    const dateTo = query.dateTo as string | undefined;
    const limitToAnalyze = 10000;

    const where: any = {
        paymentStatus: { in: ['PAID', 'CONFIRMED', 'PROCESSING'] },
    };

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

    const bookings = await prisma.booking.findMany({
        where,
        take: limitToAnalyze,
        orderBy: { createdAt: 'desc' },
        include: {
            items: {
                include: {
                    patient: { select: { name: true, age: true, gender: true } },
                },
            },
            promoCode: { select: { code: true } },
            user: { select: { name: true, mobile: true } },
            managerOrder: { select: { collectionMode: true } },
        },
    });

    // Batch-lookup all unique testCodes against CatalogItem for partnerPrice and type
    const allTestCodes = Array.from(new Set(bookings.flatMap((b) => b.items.map((i) => i.testCode))));

    const catalogLookup = new Map<string, { partnerPrice: number; type: string }>();

    if (allTestCodes.length > 0) {
        const catalogItems = await prisma.catalogItem.findMany({
            where: { partnerCode: { in: allTestCodes } },
            select: { partnerCode: true, partnerPrice: true, type: true },
        });
        for (const item of catalogItems) {
            catalogLookup.set(item.partnerCode, { partnerPrice: item.partnerPrice, type: item.type });
        }
    }

    const rows: SettlementReportRow[] = bookings.map((booking, index) => {
        const itemsTotal = booking.items.reduce((sum, item) => sum + item.price, 0);
        const collectionCharges = itemsTotal < SAMPLE_COLLECTION_FEE_THRESHOLD ? SAMPLE_COLLECTION_FEE : 0;
        const totalOrderPrice = itemsTotal;
        const discount = booking.discountAmount || 0;
        const paidAmount = totalOrderPrice + collectionCharges - discount;

        // Healthians share: sum of CatalogItem.partnerPrice for each item
        const healthiansShare = booking.items.reduce((sum, item) => {
            const catalog = catalogLookup.get(item.testCode);
            return sum + (catalog?.partnerPrice || 0);
        }, 0);

        const docnowShare = paidAmount - healthiansShare;

        // Collection charges paid: 200 if order has ZERO packages, else 0
        const hasPackage = booking.items.some((item) => {
            const catalog = catalogLookup.get(item.testCode);
            return catalog?.type === 'PACKAGE';
        });
        const collectionChargesPaid = hasPackage ? 0 : 200;

        // Payment mode
        let paymentMode: string;
        if (booking.finalAmount === 0 && (booking.walletAmount || 0) > 0) {
            paymentMode = 'Wallet';
        } else if (booking.managerOrder) {
            const mode = booking.managerOrder.collectionMode;
            if (mode === 'OFFLINE_CASH') {
                paymentMode = 'Cash';
            } else if (mode === 'OFFLINE_UPI') {
                paymentMode = 'UPI (Offline)';
            } else if (mode === 'RAZORPAY_LINK') {
                paymentMode = 'Razorpay Link';
            } else {
                paymentMode = 'Razorpay Online';
            }
        } else {
            paymentMode = 'Razorpay Online';
        }

        // Deduplicated patient details
        const seenPatients = new Set<string>();
        const patientDetails: string[] = [];
        for (const item of booking.items) {
            if (!item.patient) continue;
            const key = `${item.patient.name}-${item.patient.age}-${item.patient.gender}`;
            if (seenPatients.has(key)) continue;
            seenPatients.add(key);
            patientDetails.push(`${item.patient.name} (${item.patient.age}/${item.patient.gender})`);
        }

        return {
            sno: index + 1,
            bookingDate: formatIstDate(booking.createdAt),
            bookingTime: formatIstTime(booking.createdAt),
            bookingId: booking.partnerBookingId || booking.id,
            city: booking.addressCity || '',
            billingCustomerName: booking.billingName || booking.user?.name || '',
            patientsDetails: patientDetails.join(', '),
            deliveryStatus: booking.status,
            testNames: booking.items.map((i) => i.testName).join(', '),
            orderPrice: booking.items.map((i) => i.price).join(', '),
            collectionCharges,
            totalOrderPrice,
            paidAmount,
            discount,
            promoCode: booking.promoCode?.code || '',
            healthiansShare,
            docnowShare,
            collectionChargesPaid,
            walletAmount: booking.walletAmount || 0,
            paymentMode,
        };
    });

    return rows;
}

export function settlementRowsToCsv(rows: SettlementReportRow[]) {
    const headers = [
        'S.No',
        'Booking Date',
        'Booking Time',
        'Booking ID',
        'City',
        'Billing Customer Name',
        'Patients Details',
        'Delivery Status',
        'Tests/Packages Names',
        'Order Price',
        'Collection Charges',
        'Total Order Price',
        'Paid Amount',
        'Discount',
        'Promo Code',
        'Healthians Share',
        'DocNow Share',
        'Collection Charges Paid',
        'Wallet Amount',
        'Payment Mode',
    ];

    const csvRows = rows.map((row) => [
        row.sno,
        row.bookingDate,
        row.bookingTime,
        row.bookingId,
        row.city,
        row.billingCustomerName,
        row.patientsDetails,
        row.deliveryStatus,
        row.testNames,
        row.orderPrice,
        row.collectionCharges,
        row.totalOrderPrice,
        row.paidAmount,
        row.discount,
        row.promoCode,
        row.healthiansShare,
        row.docnowShare,
        row.collectionChargesPaid,
        row.walletAmount,
        row.paymentMode,
    ].map(csvValue).join(','));

    return '\uFEFF' + [headers.join(','), ...csvRows].join('\n');
}

export async function getSettlementReport(req: AuthRequest, res: Response) {
    try {
        const rows = await buildSettlementRows(req.query);
        res.json({
            rows,
            total: rows.length,
        });
    } catch (error) {
        console.error('[Admin] Error building settlement report:', error);
        res.status(500).json({ error: 'Failed to build settlement report' });
    }
}
