import PDFDocument from 'pdfkit';
import { prisma } from '../db';

function formatCurrency(amount: number) {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 2,
    }).format(amount);
}

function formatDate(date: Date | string) {
    return new Date(date).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}

function wrapText(value?: string | null) {
    return value?.trim() || 'Not available';
}

export async function generateInvoicePdfForBooking(bookingId: string) {
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            user: true,
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
    const issuedAt = booking.paidAt || booking.updatedAt || booking.createdAt;
    const paidAmount = booking.finalAmount || booking.totalAmount;
    const billedTo = booking.billingName || booking.user.name || 'Customer';

    // Header band
    doc.roundedRect(48, 40, 500, 92, 14).fill('#F5F1FF');
    doc.fillColor('#4B2192').font('Helvetica-Bold').fontSize(28).text('DOCNOW', 68, 62);
    doc.fillColor('#312E81').font('Helvetica-Bold').fontSize(12).text('Customer Invoice', 68, 96);
    doc.fillColor('#6B7280').font('Helvetica').fontSize(10).text('Premium diagnostics, simplified.', 68, 112);

    doc
        .fillColor('#111827')
        .font('Helvetica-Bold')
        .fontSize(11)
        .text('Invoice No.', 380, 62, { width: 120, align: 'right' })
        .text('Issued On', 380, 86, { width: 120, align: 'right' })
        .text('Booking Ref.', 380, 110, { width: 120, align: 'right' });
    doc
        .fillColor('#374151')
        .font('Helvetica')
        .text(invoiceNumber, 505, 62, { align: 'right' })
        .text(formatDate(issuedAt), 505, 86, { align: 'right' })
        .text(booking.partnerBookingId || booking.id.slice(0, 8), 505, 110, { align: 'right' });

    let y = 160;

    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(12).text('Billed To', 48, y);
    doc.fillColor('#374151').font('Helvetica').fontSize(10);
    doc.text(wrapText(billedTo), 48, y + 18);
    doc.text(wrapText(booking.user.mobile), 48, y + 34);
    doc.text(wrapText(booking.user.email), 48, y + 50);
    doc.text(
        `${wrapText(booking.addressLine)}, ${wrapText(booking.addressCity)} - ${wrapText(booking.addressPincode)}`,
        48,
        y + 66,
        { width: 240 }
    );

    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(12).text('Booking Details', 320, y);
    doc.fillColor('#374151').font('Helvetica').fontSize(10);
    doc.text(`Collection Date: ${formatDate(booking.slotDate)}`, 320, y + 18);
    doc.text(`Collection Slot: ${wrapText(booking.slotTime)}`, 320, y + 34);
    doc.text(`Payment Status: Paid & Confirmed`, 320, y + 50);
    doc.text(`Paid On: ${formatDate(issuedAt)}`, 320, y + 66);

    y += 120;

    doc
        .moveTo(48, y)
        .lineTo(548, y)
        .strokeColor('#E5E7EB')
        .stroke();

    y += 18;
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(12).text('Tests & Packages', 48, y);
    y += 26;

    doc
        .fillColor('#6B7280')
        .font('Helvetica-Bold')
        .fontSize(10)
        .text('Item', 48, y)
        .text('Patient', 320, y)
        .text('Amount', 500, y, { width: 48, align: 'right' });

    y += 18;
    doc.moveTo(48, y).lineTo(548, y).strokeColor('#E5E7EB').stroke();
    y += 10;

    booking.items.forEach((item) => {
        doc.fillColor('#111827').font('Helvetica').fontSize(10);
        doc.text(item.testName, 48, y, { width: 250 });
        doc.text(item.patient?.name || 'Patient', 320, y, { width: 120 });
        doc.text(formatCurrency(item.price), 468, y, { width: 80, align: 'right' });
        y += 24;
    });

    y += 8;
    doc.moveTo(300, y).lineTo(548, y).strokeColor('#E5E7EB').stroke();
    y += 16;

    const summaryX = 340;
    doc.fillColor('#374151').font('Helvetica').fontSize(10);
    doc.text('Subtotal', summaryX, y);
    doc.text(formatCurrency(booking.totalAmount), 470, y, { width: 78, align: 'right' });
    y += 20;

    if (booking.discountAmount > 0) {
        doc.text('Discount', summaryX, y);
        doc.text(`- ${formatCurrency(booking.discountAmount)}`, 470, y, { width: 78, align: 'right' });
        y += 20;
    }

    if (booking.walletAmount > 0) {
        doc.text('Wallet Used', summaryX, y);
        doc.text(`- ${formatCurrency(booking.walletAmount)}`, 470, y, { width: 78, align: 'right' });
        y += 20;
    }

    doc.moveTo(340, y).lineTo(548, y).strokeColor('#D1D5DB').stroke();
    y += 14;
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(12);
    doc.text('Amount Paid', summaryX, y);
    doc.text(formatCurrency(paidAmount), 450, y, { width: 98, align: 'right' });

    y += 44;
    doc
        .roundedRect(48, y, 500, 72, 10)
        .fillAndStroke('#FAFAFA', '#E5E7EB');
    doc.fillColor('#374151').font('Helvetica-Bold').fontSize(10).text('Important Note', 64, y + 16);
    doc
        .font('Helvetica')
        .fontSize(9)
        .text(
            'This is a computer-generated customer invoice/receipt for your confirmed DOCNOW booking. It is intended for order reference and payment confirmation and is not a GST tax invoice.',
            64,
            y + 32,
            { width: 468 }
        );

    y += 104;
    doc.fillColor('#6B7280').font('Helvetica').fontSize(9);
    doc.text('Need help? Reach out to the DOCNOW support team for booking or report assistance.', 48, y, {
        width: 500,
        align: 'center',
    });

    doc.end();
    const pdf = await done;

    return {
        pdf,
        filename: `invoice-${invoiceNumber}.pdf`,
        booking,
    };
}
