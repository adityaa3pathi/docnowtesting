import { afterAll, beforeEach, expect, it } from 'vitest';
import { PDFRawStream, PDFDocument as PdfLibDocument, decodePDFRawStream } from 'pdf-lib';
import { describeDb, makeAddress, makeBooking, makePatient, makeUser, resetCommerceData, testDb } from '../test/db';
import { generateInvoicePdfForBooking } from './invoiceService';

/**
 * PDFKit compresses its content streams and writes each run as kerned hex strings,
 * so read the invoice back through pdf-lib and rebuild one line per text operator.
 */
async function invoiceTextFor(bookingId: string) {
    const { pdf } = await generateInvoicePdfForBooking(bookingId);
    const doc = await PdfLibDocument.load(pdf);
    let raw = '';
    for (const [, object] of doc.context.enumerateIndirectObjects()) {
        if (!(object instanceof PDFRawStream)) continue;
        try { raw += Buffer.from(decodePDFRawStream(object).decode()).toString('latin1'); } catch { /* images and fonts */ }
    }
    return [...raw.matchAll(/\[(.*?)\]\s*TJ/gs)]
        .map(([, run]) => [...run.matchAll(/<([0-9a-fA-F]*)>/g)].map(([, hex]) => Buffer.from(hex, 'hex').toString('latin1')).join(''))
        .join('\n');
}

describeDb('the invoice payment mode for pay on collection (real Postgres)', () => {
    beforeEach(resetCommerceData);
    afterAll(async () => testDb?.$disconnect());

    async function confirmedBooking(over: Record<string, unknown>) {
        const user = await makeUser({ name: 'Asha Sharma' });
        const address = await makeAddress(user.id);
        const patient = await makePatient(user.id);
        return makeBooking({
            userId: user.id,
            addressId: address.id,
            paymentStatus: 'CONFIRMED',
            status: 'Order Booked',
            totalAmount: 1000,
            finalAmount: 1000,
            items: [{ testCode: 'DEAL1', testName: 'CBC', price: 1000, patientId: patient.id }],
            ...over,
        } as any);
    }

    it('says the money is still to be taken until the collector reports it', async () => {
        const booking = await confirmedBooking({ paymentMethod: 'PAY_ON_COLLECTION', collectedAt: null });
        expect(await invoiceTextFor(booking.id)).toContain('To be paid at sample collection');
    });

    it('says paid at sample collection once the money has been taken', async () => {
        const booking = await confirmedBooking({ paymentMethod: 'PAY_ON_COLLECTION', collectedAt: new Date(), collectedAmount: 1000 });
        const text = await invoiceTextFor(booking.id);
        expect(text).toContain('Paid at sample collection');
        expect(text).not.toContain('To be paid at sample collection');
    });

    it('still names Razorpay for an online booking and the wallet for a zero-amount one', async () => {
        const online = await confirmedBooking({ paymentMethod: 'ONLINE', razorpayPaymentId: 'pay_real_1' });
        expect(await invoiceTextFor(online.id)).toContain('Online (Razorpay)');

        const wallet = await confirmedBooking({ paymentMethod: 'ONLINE', finalAmount: 0, walletAmount: 1000, razorpayPaymentId: 'ZERO_abc' });
        expect(await invoiceTextFor(wallet.id)).toContain('Wallet / promo');
    });
});
