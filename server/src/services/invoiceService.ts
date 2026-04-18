import PDFDocument from 'pdfkit';
import path from 'path';
import { prisma } from '../db';

type InvoiceLine = {
    name: string;
    quantity: number;
    unitPrice: number;
    discount: number;
    finalPrice: number;
    patientName: string;
};

const COMPANY = {
    name: process.env.DOCNOW_COMPANY_NAME || 'DOCNOW',
    registeredAddress:
        process.env.DOCNOW_REGISTERED_ADDRESS ||
        'Shop No 21, Chandpole Bazar, Jaipur',
    supportPhone: process.env.DOCNOW_SUPPORT_PHONE || '+91 9649089089',
    supportEmail: process.env.DOCNOW_SUPPORT_EMAIL || 'docnowhealthcare@gmail.com',
    gstin: process.env.DOCNOW_GSTIN || 'GSTIN pending configuration',
    refundPolicy:
        process.env.DOCNOW_REFUND_POLICY ||
        'Refunds and cancellations are subject to DOCNOW booking and sample-collection policy.',
};

const COLORS = {
    brand: '#4B2192',
    brandSoft: '#F5EFFF',
    brandLine: '#E7D8FF',
    text: '#111827',
    muted: '#4B5563',
    subtle: '#6B7280',
    border: '#E5E7EB',
    borderSoft: '#F1F5F9',
    panel: '#FAFAFA',
    panelCool: '#F8FAFC',
};

function formatCurrency(amount: number) {
    const formatted = new Intl.NumberFormat('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(amount);

    return `Rs. ${formatted}`;
}

function formatDate(date?: Date | string | null) {
    if (!date) return 'Not available';
    return new Date(date).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}

function formatDateTime(date?: Date | string | null) {
    if (!date) return 'Not available';
    return new Date(date).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function wrapText(value?: string | null) {
    return value?.trim() || 'Not available';
}

function loadLogoPath() {
    return path.resolve(process.cwd(), 'assets', 'docnow-logo.png');
}

function derivePaymentMode(booking: any) {
    const collectionMode = booking.managerOrder?.collectionMode;

    if (collectionMode === 'OFFLINE_CASH') return 'Cash';
    if (collectionMode === 'OFFLINE_UPI') return 'UPI';
    if (collectionMode === 'RAZORPAY_LINK') return 'Online';
    if (booking.razorpayPaymentId) return 'Online';
    return booking.paymentStatus === 'CONFIRMED' ? 'Paid Online' : 'Pending';
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

function derivePaymentStatus(booking: any) {
    if (booking.paymentStatus === 'CONFIRMED') return 'Paid';
    if (booking.paymentStatus === 'AUTHORIZED' || booking.paymentStatus === 'PAID') return 'Pending Confirmation';
    return 'Pending';
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
            discount: allocatedDiscount,
            finalPrice,
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

function drawLabelValue(doc: PDFKit.PDFDocument, label: string, value: string, x: number, y: number, width = 220) {
    doc.fillColor(COLORS.subtle).font('Helvetica-Bold').fontSize(9).text(label, x, y, { width });
    doc.fillColor(COLORS.text).font('Helvetica').fontSize(10).text(value, x, y + 13, { width });
}

function getPrimaryPatient(booking: any) {
    const firstPatient = booking.items[0]?.patient;

    return {
        name: firstPatient?.name || booking.billingName || booking.user.name || 'Customer',
        ageGender:
            firstPatient?.age && firstPatient?.gender
                ? `${firstPatient.age} / ${firstPatient.gender}`
                : booking.user.age && booking.user.gender
                    ? `${booking.user.age} / ${booking.user.gender}`
                    : 'Not available',
    };
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

    const invoiceNumber = `DOC-${booking.id.slice(0, 8).toUpperCase()}`;
    const issuedAt = booking.paidAt || booking.managerOrder?.confirmedAt || booking.updatedAt || booking.createdAt;
    const primaryPatient = getPrimaryPatient(booking);
    const paymentMode = derivePaymentMode(booking);
    const paymentReference = derivePaymentReference(booking);
    const paymentStatus = derivePaymentStatus(booking);
    const lines = buildInvoiceLines(booking);
    const subtotal = booking.totalAmount || 0;
    const totalDiscount = booking.discountAmount || 0;
    const totalAmountPayable = booking.finalAmount || booking.totalAmount || 0;
    const logoPath = loadLogoPath();

    doc.roundedRect(48, 38, 500, 118, 14).fill(COLORS.brandSoft);
    doc.roundedRect(48, 38, 500, 118, 14).stroke(COLORS.brandLine);
    doc.image(logoPath, 64, 56, { width: 154 });
    doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(16).text(COMPANY.name, 64, 108);
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9);
    doc.text(COMPANY.registeredAddress, 64, 126, { width: 230, lineGap: 2 });
    doc.fillColor(COLORS.muted).font('Helvetica-Bold').fontSize(9).text(`GSTIN: ${COMPANY.gstin}`, 64, 146, {
        width: 230,
    });

    doc.roundedRect(332, 56, 190, 80, 12).fill('#FFFFFF');
    doc.roundedRect(332, 56, 190, 80, 12).stroke(COLORS.brandLine);
    doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(11);
    doc.text('Invoice Number', 348, 70, { width: 86 });
    doc.text('Invoice Date', 348, 91, { width: 86 });
    doc.text('Booking ID', 348, 112, { width: 86 });
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(10);
    doc.text(invoiceNumber, 438, 70, { width: 68, align: 'left' });
    doc.text(formatDate(issuedAt), 438, 91, { width: 68, align: 'left' });
    doc.text(booking.partnerBookingId || booking.id, 438, 112, { width: 68, align: 'left' });

    let y = 188;

    doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(12).text('Patient Details', 48, y);
    doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(12).text('Collection Details', 318, y);
    y += 20;

    drawLabelValue(doc, 'Patient Name', primaryPatient.name, 48, y);
    drawLabelValue(doc, 'Sample Collection Date & Time', `${wrapText(booking.slotDate)} | ${wrapText(booking.slotTime)}`, 318, y, 230);
    drawLabelValue(doc, 'Age / Gender', primaryPatient.ageGender, 48, y + 38);
    drawLabelValue(doc, 'Payment Mode', paymentMode, 318, y + 38, 230);
    drawLabelValue(doc, 'Phone Number', wrapText(booking.user.mobile), 48, y + 76);
    drawLabelValue(doc, 'Payment Status', paymentStatus, 318, y + 76, 230);
    drawLabelValue(
        doc,
        'Address',
        `${wrapText(booking.addressLine)}, ${wrapText(booking.addressCity)} - ${wrapText(booking.addressPincode)}`,
        48,
        y + 114,
        230
    );
    drawLabelValue(doc, 'Transaction / Reference', wrapText(paymentReference), 318, y + 114, 230);
    drawLabelValue(doc, 'Payment Date', formatDateTime(booking.paidAt || booking.managerOrder?.confirmedAt || issuedAt), 318, y + 152, 230);

    y += 214;

    doc.moveTo(48, y).lineTo(548, y).strokeColor(COLORS.border).stroke();
    y += 18;
    doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(12).text('Invoice Items', 48, y);
    y += 22;

    doc.fillColor(COLORS.subtle).font('Helvetica-Bold').fontSize(9);
    doc.text('Test / Package', 48, y, { width: 240 });
    doc.text('Qty', 290, y, { width: 32, align: 'center' });
    doc.text('Unit Price', 338, y, { width: 68, align: 'right' });
    doc.text('Discount', 410, y, { width: 62, align: 'right' });
    doc.text('Final Price', 472, y, { width: 76, align: 'right' });
    y += 18;
    doc.moveTo(48, y).lineTo(548, y).strokeColor(COLORS.border).stroke();
    y += 10;

    lines.forEach((line) => {
        y = ensureSpace(doc, 46, y);

        doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(10).text(line.name, 48, y, { width: 230 });
        doc.fillColor(COLORS.subtle).font('Helvetica').fontSize(8).text(`Patient: ${line.patientName}`, 48, y + 13, { width: 230 });
        doc.text(String(line.quantity), 290, y, { width: 32, align: 'center' });
        doc.text(formatCurrency(line.unitPrice), 338, y, { width: 68, align: 'right' });
        doc.text(line.discount > 0 ? `- ${formatCurrency(line.discount)}` : formatCurrency(0), 410, y, { width: 62, align: 'right' });
        doc.fillColor(COLORS.text).font('Helvetica-Bold').text(formatCurrency(line.finalPrice), 472, y, { width: 76, align: 'right' });
        y += 34;
        doc.moveTo(48, y).lineTo(548, y).strokeColor(COLORS.borderSoft).stroke();
        y += 12;
    });

    y += 4;
    y = ensureSpace(doc, 180, y);

    doc.roundedRect(308, y, 240, 106, 10).fill(COLORS.panel);
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(10);
    doc.text('Pricing Subtotal', 326, y + 18);
    doc.text(formatCurrency(subtotal), 450, y + 18, { width: 80, align: 'right' });
    doc.text('Total Discount', 326, y + 42);
    doc.text(totalDiscount > 0 ? `- ${formatCurrency(totalDiscount)}` : formatCurrency(0), 450, y + 42, { width: 80, align: 'right' });
    doc.moveTo(326, y + 68).lineTo(530, y + 68).strokeColor('#D1D5DB').stroke();
    doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(11);
    doc.text('Total Amount Payable', 326, y + 78);
    doc.text(formatCurrency(totalAmountPayable), 430, y + 78, { width: 100, align: 'right' });

    y += 132;
    y = ensureSpace(doc, 120, y);

    doc.roundedRect(48, y, 500, 94, 10).fill(COLORS.panelCool);
    doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(10).text('Important Notes', 64, y + 14);
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9);
    doc.text('This is a computer-generated invoice generated by DOCNOW.', 64, y + 32, { width: 468 });
    doc.text(`Support: ${COMPANY.supportPhone} | ${COMPANY.supportEmail}`, 64, y + 48, { width: 468 });
    doc.text(`Refund / cancellation policy: ${COMPANY.refundPolicy}`, 64, y + 66, { width: 468 });

    doc.end();
    const pdf = await done;

    return {
        pdf,
        filename: `invoice-${invoiceNumber}.pdf`,
        booking,
    };
}
