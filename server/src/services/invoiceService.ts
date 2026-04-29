import PDFDocument from 'pdfkit';
import path from 'path';
import { prisma } from '../db';

type InvoiceLine = {
    name: string;
    quantity: number;
    unitPrice: number;
    amount: number;
    patientName: string;
};

const COMPANY = {
    name: 'DocNow Healthcare',
    address: 'Shop no 21, Chandpole Bazar,\nJaipur, Rajasthan',
    phone: '9649 089 089',
    email: process.env.DOCNOW_SUPPORT_EMAIL || 'docnowhealthcare@gmail.com',
    gstin: '08CXNPA3369J1Z4',
};

// Colors from the invoice template screenshot
const COLORS = {
    band: '#58057D',         // Deep purple header/footer bar
    black: '#000000',
    text: '#1F2937',
    muted: '#4B5563',
    subtle: '#6B7280',
    border: '#374151',
    borderLight: '#D1D5DB',
    white: '#FFFFFF',
    brandPurple: '#4B2192',  // DOCNOW logo text color
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
        month: '2-digit',
        year: 'numeric',
    });
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

function buildInvoiceLines(booking: any): InvoiceLine[] {
    const subtotal = booking.totalAmount || 0;
    const totalDiscount = booking.discountAmount || 0;

    return booking.items.map((item: any, index: number) => {
        const ratio = subtotal > 0 ? item.price / subtotal : 0;
        const rawDiscount = totalDiscount > 0 ? totalDiscount * ratio : 0;
        const allocatedDiscount =
            index === booking.items.length - 1
                ? Number(
                    (
                        totalDiscount -
                        booking.items
                            .slice(0, index)
                            .reduce((sum: number, previous: any) => sum + (subtotal > 0 ? totalDiscount * (previous.price / subtotal) : 0), 0)
                    ).toFixed(2)
                )
                : Number(rawDiscount.toFixed(2));

        const finalPrice = Number(Math.max(item.price - allocatedDiscount, 0).toFixed(2));

        return {
            name: item.testName,
            quantity: 1,
            unitPrice: item.price,
            amount: finalPrice,
            patientName: item.patient?.name || 'Patient',
        };
    });
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number, currentY: number) {
    if (currentY + needed <= doc.page.height - 60) {
        return currentY;
    }
    doc.addPage();
    return 48;
}

export async function generateInvoicePdfForBooking(bookingId: string) {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            user: true,
            managerOrder: true,
            items: {
                include: {
                    patient: true,
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

    const pageWidth = doc.page.width;   // 595.28
    const pageHeight = doc.page.height; // 841.89
    const margin = 48;
    const contentWidth = pageWidth - margin * 2;

    const invoiceNumber = `DOC-${booking.id.slice(0, 8).toUpperCase()}`;
    const issuedAt = booking.paidAt || booking.managerOrder?.confirmedAt || booking.updatedAt || booking.createdAt;
    const paymentMode = derivePaymentMode(booking);
    const paymentReference = derivePaymentReference(booking);
    const lines = buildInvoiceLines(booking);
    const subtotal = booking.totalAmount || 0;
    const totalDiscount = booking.discountAmount || 0;
    const totalAmount = booking.finalAmount || booking.totalAmount || 0;
    const logoPath = loadLogoPath();

    // ─── INVOICE title ───────────────────────────────────────────────────
    let y = 40;
    doc.fillColor(COLORS.black).font('Helvetica-Bold').fontSize(28).text('INVOICE', margin, y);

    // ─── DOCNOW logo (top right) ─────────────────────────────────────────
    try {
        doc.image(logoPath, pageWidth - margin - 120, y - 5, { width: 120 });
    } catch {
        // Fallback: text-based logo
        doc.fillColor(COLORS.brandPurple).font('Helvetica-Bold').fontSize(22)
            .text('DOCNOW', pageWidth - margin - 130, y, { width: 130, align: 'right' });
    }

    // ─── Invoice Number & Date ───────────────────────────────────────────
    y = 80;
    doc.fillColor(COLORS.text).font('Helvetica').fontSize(10);
    doc.text(`Invoice Number: #${invoiceNumber}`, margin, y);
    doc.text(`Invoice Date: ${formatDate(issuedAt)}`, margin, y + 16);

    // ─── Horizontal separator ────────────────────────────────────────────
    y = 126;
    doc.moveTo(margin, y).lineTo(pageWidth - margin, y).strokeColor(COLORS.borderLight).lineWidth(0.5).stroke();

    // ─── Two-column: Company (left) + Bill To (right) ────────────────────
    y = 140;
    const colLeft = margin;
    const colRight = margin + contentWidth / 2 + 20;

    // Company details (left column)
    doc.fillColor(COLORS.black).font('Helvetica-Bold').fontSize(11).text(COMPANY.name.toUpperCase(), colLeft, y);
    y += 18;
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9.5);
    doc.text(COMPANY.address, colLeft, y, { width: contentWidth / 2 - 20, lineGap: 2 });
    y += 30;
    doc.text(`+91 ${COMPANY.phone}`, colLeft, y);
    y += 14;
    doc.text(COMPANY.email, colLeft, y);
    y += 14;
    doc.text(`GSTIN: ${COMPANY.gstin}`, colLeft, y);

    // Bill To (right column)
    let rightY = 140;
    doc.fillColor(COLORS.black).font('Helvetica-Bold').fontSize(11).text('BILL TO', colRight, rightY);
    rightY += 18;
    doc.fillColor(COLORS.text).font('Helvetica').fontSize(9.5);
    const customerName = booking.billingName || booking.user.name || 'Customer';
    doc.text(customerName, colRight, rightY, { width: contentWidth / 2 - 20 });
    rightY += 14;
    const addressParts = [
        booking.addressLine,
        booking.addressCity,
        booking.addressPincode ? `- ${booking.addressPincode}` : '',
    ].filter(Boolean).join(', ');
    doc.text(addressParts || 'Address not available', colRight, rightY, { width: contentWidth / 2 - 20, lineGap: 2 });
    rightY += 28;
    doc.text(`+91 ${booking.user.mobile}`, colRight, rightY);
    rightY += 14;
    if (booking.user.email) {
        doc.text(booking.user.email, colRight, rightY);
    }

    // ─── Items Table ─────────────────────────────────────────────────────
    y = 250;
    doc.moveTo(margin, y).lineTo(pageWidth - margin, y).strokeColor(COLORS.borderLight).lineWidth(0.5).stroke();
    y += 16;

    // Table header
    const col1 = margin + 8;          // Item & Description
    const col2 = margin + 310;        // Unit Price
    const col3 = margin + 390;        // Qty
    const col4 = margin + 430;        // Amount
    const colEnd = pageWidth - margin - 8;

    doc.fillColor(COLORS.black).font('Helvetica-Bold').fontSize(10);
    doc.text('Item & Description', col1, y, { width: 280 });
    doc.text('Unit Price', col2, y, { width: 70, align: 'right' });
    doc.text('Qty', col3, y, { width: 30, align: 'center' });
    doc.text('Amount', col4, y, { width: colEnd - col4, align: 'right' });

    y += 18;
    doc.moveTo(margin, y).lineTo(pageWidth - margin, y).strokeColor(COLORS.border).lineWidth(0.5).stroke();
    y += 2;

    // Table rows
    lines.forEach((line) => {
        // Calculate how tall the test name will be when wrapped
        const nameHeight = doc.font('Helvetica').fontSize(10).heightOfString(line.name, { width: 280 });
        const patientLineH = 14; // height for the patient name sub-line
        const rowPadding = 20;   // top + bottom padding
        const rowHeight = Math.max(38, nameHeight + patientLineH + rowPadding);

        y = ensureSpace(doc, rowHeight + 10, y);
        y += 10;

        // Side borders for row
        doc.moveTo(margin, y - 4).lineTo(margin, y + rowHeight - 2).strokeColor(COLORS.borderLight).lineWidth(0.5).stroke();
        doc.moveTo(pageWidth - margin, y - 4).lineTo(pageWidth - margin, y + rowHeight - 2).strokeColor(COLORS.borderLight).lineWidth(0.5).stroke();

        // Test name (wraps automatically)
        doc.fillColor(COLORS.text).font('Helvetica').fontSize(10);
        doc.text(line.name, col1, y, { width: 280 });

        // Patient name below the test name, after the wrapped text
        const nameBottom = y + nameHeight + 2;
        doc.fillColor(COLORS.subtle).font('Helvetica').fontSize(8);
        doc.text(`Patient: ${line.patientName}`, col1, nameBottom, { width: 280 });

        // Price columns aligned to the top of the row
        doc.fillColor(COLORS.text).font('Helvetica').fontSize(10);
        doc.text(formatCurrency(line.unitPrice), col2, y, { width: 70, align: 'right' });
        doc.text(String(line.quantity), col3, y, { width: 30, align: 'center' });
        doc.font('Helvetica-Bold').text(formatCurrency(line.amount), col4, y, { width: colEnd - col4, align: 'right' });

        y += rowHeight;
        doc.moveTo(margin, y).lineTo(pageWidth - margin, y).strokeColor(COLORS.borderLight).lineWidth(0.5).stroke();
    });

    y += 20;

    // ─── Notes/Terms (left) + Totals box (right) ────────────────────────
    y = ensureSpace(doc, 160, y);
    const notesX = margin;
    const totalsX = margin + contentWidth / 2 + 40;
    const totalsW = contentWidth / 2 - 40;

    // Notes / Terms
    doc.fillColor(COLORS.black).font('Helvetica-Bold').fontSize(11).text('NOTES / TERMS:', notesX, y);
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9).text(
        'This is a computer-generated invoice\nby DocNow Healthcare.\nNo signature required.',
        notesX, y + 18, { width: contentWidth / 2 - 20, lineGap: 3 }
    );

    // Totals box
    const boxY = y - 4;
    const boxH = 82;
    doc.rect(totalsX - 8, boxY, totalsW + 16, boxH).strokeColor(COLORS.borderLight).lineWidth(0.5).stroke();

    let tY = boxY + 12;
    doc.fillColor(COLORS.text).font('Helvetica').fontSize(10);
    doc.text('Sub-Total', totalsX, tY, { width: totalsW / 2 });
    doc.text(formatCurrency(subtotal), totalsX + totalsW / 2, tY, { width: totalsW / 2, align: 'right' });

    tY += 22;
    doc.text('Discount', totalsX, tY, { width: totalsW / 2 });
    doc.text(totalDiscount > 0 ? `- ${formatCurrency(totalDiscount)}` : formatCurrency(0), totalsX + totalsW / 2, tY, { width: totalsW / 2, align: 'right' });

    tY += 22;
    doc.moveTo(totalsX - 8, tY - 4).lineTo(totalsX + totalsW + 8, tY - 4).strokeColor(COLORS.borderLight).lineWidth(0.5).stroke();
    doc.fillColor(COLORS.black).font('Helvetica-Bold').fontSize(11);
    doc.text('Total', totalsX, tY, { width: totalsW / 2 });
    doc.text(formatCurrency(totalAmount), totalsX + totalsW / 2, tY, { width: totalsW / 2, align: 'right' });

    // ─── Payment Method (bottom section, no "Prepared By") ───────────────
    y = Math.max(y + 90, tY + 60);
    y = ensureSpace(doc, 100, y);

    doc.moveTo(margin, y).lineTo(pageWidth - margin, y).strokeColor(COLORS.borderLight).lineWidth(0.5).stroke();
    y += 16;

    doc.fillColor(COLORS.black).font('Helvetica-Bold').fontSize(11).text('PAYMENT METHOD', notesX, y);
    y += 18;
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9.5);
    doc.text(`Mode: ${paymentMode}`, notesX, y);
    y += 14;
    doc.text(`Reference: ${paymentReference}`, notesX, y);
    y += 14;
    doc.text(`Booking ID: ${booking.partnerBookingId || booking.id}`, notesX, y);

    // ─── Bottom Band ─────────────────────────────────────────────────────
    doc.rect(0, pageHeight - 12, pageWidth, 12).fill(COLORS.band);

    doc.end();
    const pdf = await done;

    return {
        pdf,
        filename: `invoice-${invoiceNumber}.pdf`,
        booking,
    };
}
