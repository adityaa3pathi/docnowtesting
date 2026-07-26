/**
 * ==========================================
 * CAMP INVOICE / REGISTRATION RECEIPT SERVICE
 * ==========================================
 *
 * Generates a professional PDF receipt for health camp registrations.
 * Separate from the standard invoiceService.ts to avoid disrupting
 * regular home-collection booking invoices.
 *
 * Key differences from standard invoice:
 * - No itemized test pricing (camp is a flat-rate package)
 * - Shows camp name, location, and scheduled dates prominently
 * - Lists included tests as a simple bullet list (no prices)
 * - Clean "Registration Receipt" title instead of "Invoice"
 */
import PDFDocument from 'pdfkit';
import path from 'path';
import { prisma } from '../db';

const COMPANY = {
    name: 'DocNow Healthcare',
    address: 'Shop no 21, Chandpole Bazar,\nJaipur, Rajasthan',
    phone: '9649 089 089',
    email: process.env.DOCNOW_SUPPORT_EMAIL || 'docnowhealthcare@gmail.com',
    gstin: '08CXNPA3369J1Z4',
};

const COLORS = {
    band: '#58057D',
    black: '#000000',
    text: '#1F2937',
    muted: '#4B5563',
    subtle: '#6B7280',
    border: '#374151',
    borderLight: '#D1D5DB',
    white: '#FFFFFF',
    brandPurple: '#4B2192',
    accentPurple: '#7C3AED',
    lightPurple: '#F3E8FF',
};

function formatCurrency(amount: number) {
    const formatted = new Intl.NumberFormat('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(amount);
    return `Rs.${formatted}`;
}

function formatDate(date?: Date | string | null) {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
    });
}

function formatDateRange(start?: Date | string | null, end?: Date | string | null) {
    const s = formatDate(start);
    const e = formatDate(end);
    if (s === e || e === 'N/A') return s;
    return `${s} – ${e}`;
}

function loadLogoPath() {
    return path.resolve(process.cwd(), 'assets', 'docnow-logo.png');
}

function derivePaymentMode(booking: any) {
    const collectionMode = booking.managerOrder?.collectionMode;
    if (collectionMode === 'OFFLINE_CASH') return 'Cash';
    if (collectionMode === 'OFFLINE_UPI') return 'UPI';
    if (collectionMode === 'RAZORPAY_LINK') return 'Online (Razorpay)';
    if (booking.razorpayPaymentId) return 'Online (Razorpay)';
    return booking.paymentStatus === 'CONFIRMED' ? 'Online' : 'Pending';
}

function derivePaymentReference(booking: any) {
    return (
        booking.razorpayPaymentId ||
        booking.razorpayOrderId ||
        booking.managerOrder?.razorpayLinkId ||
        booking.partnerBookingId ||
        booking.id
    );
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number, currentY: number) {
    if (currentY + needed <= doc.page.height - 60) {
        return currentY;
    }
    doc.addPage();
    return 48;
}

export async function generateCampInvoicePdf(bookingId: string) {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            user: true,
            managerOrder: true,
            camp: {
                select: {
                    name: true,
                    location: true,
                    city: true,
                    pincode: true,
                    startDate: true,
                    endDate: true,
                },
            },
            items: {
                include: {
                    patient: { select: { name: true } },
                },
            },
        },
    });

    if (!booking) {
        throw new Error('Booking not found');
    }

    if (booking.paymentStatus !== 'CONFIRMED') {
        throw new Error('Invoice is available only after the booking is confirmed');
    }

    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    const done = new Promise<Buffer>((resolve, reject) => {
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
    });

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 48;
    const contentWidth = pageWidth - margin * 2;

    const invoiceNumber = `DOC-${booking.id.slice(0, 8).toUpperCase()}`;
    const issuedAt = booking.paidAt || booking.managerOrder?.confirmedAt || booking.updatedAt || booking.createdAt;
    const paymentMode = derivePaymentMode(booking);
    const paymentReference = derivePaymentReference(booking);
    const subtotal = booking.totalAmount || 0;
    const totalDiscount = booking.discountAmount || 0;
    const walletApplied = booking.walletAmount || 0;
    const totalAmount = booking.finalAmount ?? booking.totalAmount ?? 0;
    const logoPath = loadLogoPath();

    const campName = booking.camp?.name || 'Health Camp';
    const campLocation = [
        booking.camp?.location,
        booking.camp?.city,
        booking.camp?.pincode,
    ].filter(Boolean).join(', ');
    const campDates = formatDateRange(booking.camp?.startDate, booking.camp?.endDate);

    const patientNames = [
        ...new Set(booking.items.map((i: any) => i.patient?.name).filter(Boolean)),
    ] as string[];

    const testNames = booking.items.map((i: any) => i.testName).filter(Boolean);

    // ─── Top accent band ─────────────────────────────────────────────────
    doc.rect(0, 0, pageWidth, 6).fill(COLORS.band);

    // ─── Title + Logo ────────────────────────────────────────────────────
    let y = 24;
    doc.fillColor(COLORS.black).font('Helvetica-Bold').fontSize(24)
        .text('REGISTRATION RECEIPT', margin, y);

    try {
        doc.image(logoPath, pageWidth - margin - 120, y - 5, { width: 120 });
    } catch {
        doc.fillColor(COLORS.brandPurple).font('Helvetica-Bold').fontSize(22)
            .text('DOCNOW', pageWidth - margin - 130, y, { width: 130, align: 'right' });
    }

    // ─── Receipt metadata ────────────────────────────────────────────────
    y = 58;
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9.5);
    doc.text(`Receipt No: #${invoiceNumber}`, margin, y);
    doc.text(`Date: ${formatDate(issuedAt)}`, margin, y + 14);

    // ─── Separator ───────────────────────────────────────────────────────
    y = 92;
    doc.moveTo(margin, y).lineTo(pageWidth - margin, y)
        .strokeColor(COLORS.borderLight).lineWidth(0.5).stroke();

    // ─── Two-column: Company (left) + Bill To (right) ────────────────────
    y = 106;
    const colLeft = margin;
    const colRight = margin + contentWidth / 2 + 20;

    doc.fillColor(COLORS.black).font('Helvetica-Bold').fontSize(10)
        .text(COMPANY.name.toUpperCase(), colLeft, y);
    y += 16;
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9);
    doc.text(COMPANY.address, colLeft, y, { width: contentWidth / 2 - 20, lineGap: 2 });
    y += 28;
    doc.text(`+91 ${COMPANY.phone}`, colLeft, y);
    y += 13;
    doc.text(COMPANY.email, colLeft, y);
    y += 13;
    doc.text(`GSTIN: ${COMPANY.gstin}`, colLeft, y);

    let rightY = 106;
    doc.fillColor(COLORS.black).font('Helvetica-Bold').fontSize(10)
        .text('BILL TO', colRight, rightY);
    rightY += 16;
    doc.fillColor(COLORS.text).font('Helvetica').fontSize(9);
    const customerName = booking.billingName || booking.user.name || 'Customer';
    doc.text(customerName, colRight, rightY, { width: contentWidth / 2 - 20 });
    rightY += 13;
    const billAddress = [
        booking.addressLine || booking.camp?.location,
        booking.addressCity || booking.camp?.city,
        (booking.addressPincode || booking.camp?.pincode) ? `- ${booking.addressPincode || booking.camp?.pincode}` : '',
    ].filter(Boolean).join(', ');
    doc.text(billAddress || 'Address not available', colRight, rightY, { width: contentWidth / 2 - 20, lineGap: 2 });
    rightY += 26;
    doc.text(`+91 ${booking.user.mobile}`, colRight, rightY);
    rightY += 13;
    if (booking.user.email) {
        doc.text(booking.user.email, colRight, rightY);
    }

    // ─── Camp Details Section ────────────────────────────────────────────
    y = 210;
    doc.moveTo(margin, y).lineTo(pageWidth - margin, y)
        .strokeColor(COLORS.borderLight).lineWidth(0.5).stroke();
    y += 14;

    doc.fillColor(COLORS.black).font('Helvetica-Bold').fontSize(11)
        .text('CAMP DETAILS', margin, y);
    y += 22;

    // Camp info grid
    const labelW = 100;
    const valueX = margin + labelW;
    const valueW = contentWidth - labelW;

    const campDetails: [string, string][] = [
        ['Camp Name', campName],
        ['Location', campLocation || 'N/A'],
        ['Scheduled', campDates],
        ['Patient', patientNames.join(', ') || customerName],
    ];

    for (const [label, value] of campDetails) {
        doc.fillColor(COLORS.subtle).font('Helvetica').fontSize(9)
            .text(`${label}:`, margin, y, { width: labelW });
        doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(9)
            .text(value, valueX, y, { width: valueW });
        y += 18;
    }

    // ─── Included Tests Section ──────────────────────────────────────────
    y += 8;
    y = ensureSpace(doc, 80, y);
    doc.moveTo(margin, y).lineTo(pageWidth - margin, y)
        .strokeColor(COLORS.borderLight).lineWidth(0.5).stroke();
    y += 14;

    doc.fillColor(COLORS.black).font('Helvetica-Bold').fontSize(11)
        .text('INCLUDED TESTS & PACKAGES', margin, y);
    y += 20;

    doc.fillColor(COLORS.text).font('Helvetica').fontSize(9);
    const colMid = margin + contentWidth / 2;

    for (let i = 0; i < testNames.length; i++) {
        const xPos = i % 2 === 0 ? margin + 12 : colMid;

        // Page break check every 2 items
        if (i % 2 === 0) {
            y = ensureSpace(doc, 22, y);
        }

        // Bullet
        doc.fillColor(COLORS.accentPurple)
            .circle(xPos - 4, y + 4, 2.5).fill();

        // Test name
        doc.fillColor(COLORS.text).font('Helvetica').fontSize(9)
            .text(testNames[i], xPos + 4, y, { width: contentWidth / 2 - 24 });

        if (i % 2 === 1 || i === testNames.length - 1) {
            y += 18;
        }
    }

    // Total test count label
    y += 4;
    doc.fillColor(COLORS.subtle).font('Helvetica').fontSize(8)
        .text(`${testNames.length} test${testNames.length !== 1 ? 's' : ''} & package${testNames.length !== 1 ? 's' : ''} included in this camp`, margin + 12, y);

    // ─── Payment Summary ─────────────────────────────────────────────────
    y += 28;
    y = ensureSpace(doc, 160, y);
    doc.moveTo(margin, y).lineTo(pageWidth - margin, y)
        .strokeColor(COLORS.borderLight).lineWidth(0.5).stroke();
    y += 14;

    const notesX = margin;
    const totalsX = margin + contentWidth / 2 + 40;
    const totalsW = contentWidth / 2 - 40;

    // Notes
    doc.fillColor(COLORS.black).font('Helvetica-Bold').fontSize(10)
        .text('NOTES / TERMS:', notesX, y);
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8.5).text(
        'This is a computer-generated receipt\nby DocNow Healthcare.\nNo signature required.\n\nPlease carry a valid photo ID\nto the camp venue.',
        notesX, y + 16, { width: contentWidth / 2 - 20, lineGap: 3 }
    );

    // Totals box
    const rowH = 22;
    const totalSectionPad = 14; // equal padding above and below "Total Paid" text
    const dataRows = 2 + (walletApplied > 0 ? 1 : 0);
    const boxY = y - 4;
    const boxH = 12 + dataRows * rowH + totalSectionPad + rowH + totalSectionPad;
    doc.rect(totalsX - 8, boxY, totalsW + 16, boxH)
        .strokeColor(COLORS.borderLight).lineWidth(0.5).stroke();

    let tY = boxY + 12;
    doc.fillColor(COLORS.text).font('Helvetica').fontSize(10);
    doc.text('Camp Fee', totalsX, tY, { width: totalsW / 2 });
    doc.text(formatCurrency(subtotal), totalsX + totalsW / 2, tY, { width: totalsW / 2, align: 'right' });

    tY += rowH;
    doc.text('Discount', totalsX, tY, { width: totalsW / 2 });
    doc.text(
        totalDiscount > 0 ? `- ${formatCurrency(totalDiscount)}` : formatCurrency(0),
        totalsX + totalsW / 2, tY, { width: totalsW / 2, align: 'right' }
    );

    if (walletApplied > 0) {
        tY += rowH;
        doc.text('Wallet Applied', totalsX, tY, { width: totalsW / 2 });
        doc.text(`- ${formatCurrency(walletApplied)}`, totalsX + totalsW / 2, tY, { width: totalsW / 2, align: 'right' });
    }

    // Separator line between detail rows and total
    tY += rowH;
    doc.moveTo(totalsX - 8, tY).lineTo(totalsX + totalsW + 8, tY)
        .strokeColor(COLORS.borderLight).lineWidth(0.5).stroke();

    // Total row — vertically centered between separator and box bottom
    tY += totalSectionPad;
    doc.fillColor(COLORS.black).font('Helvetica-Bold').fontSize(11);
    doc.text('Total Paid', totalsX, tY, { width: totalsW / 2 });
    doc.text(formatCurrency(totalAmount), totalsX + totalsW / 2, tY, { width: totalsW / 2, align: 'right' });

    // ─── Payment Method ──────────────────────────────────────────────────
    y = Math.max(y + 95, tY + 55);
    y = ensureSpace(doc, 90, y);

    doc.moveTo(margin, y).lineTo(pageWidth - margin, y)
        .strokeColor(COLORS.borderLight).lineWidth(0.5).stroke();
    y += 14;

    doc.fillColor(COLORS.black).font('Helvetica-Bold').fontSize(10)
        .text('PAYMENT METHOD', notesX, y);
    y += 16;
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9);
    doc.text(`Mode: ${paymentMode}`, notesX, y);
    y += 13;
    doc.text(`Reference: ${paymentReference}`, notesX, y);
    y += 13;
    doc.text(`Booking ID: ${booking.partnerBookingId || booking.id}`, notesX, y);

    // ─── Bottom Band ─────────────────────────────────────────────────────
    doc.rect(0, pageHeight - 10, pageWidth, 10).fill(COLORS.band);

    doc.end();
    const pdf = await done;

    return {
        pdf,
        filename: `camp-receipt-${invoiceNumber}.pdf`,
        booking,
    };
}
