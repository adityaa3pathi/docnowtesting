import { ConsultRazorpay, RazorpayError, RazorpayPayment, RazorpayRefund } from '../consultations.razorpay';

/** In-memory Razorpay for tests. Set failures and payments directly on the instance. */
export class FakeRazorpay implements ConsultRazorpay {
    orders: { id: string; amountPaise: number; receipt: string; notes: Record<string, string> }[] = [];
    payments = new Map<string, RazorpayPayment[]>();
    refunds: (RazorpayRefund & { paymentId: string })[] = [];
    /** Queue of outcomes for the next createRefund calls: an error to throw, or 'timeout' (refund made, then a network error). */
    refundScript: (RazorpayError | 'timeout')[] = [];
    refundCalls = 0;
    refundStatus = 'processed';

    async createRefund(input: { paymentId: string; amountPaise: number; receipt: string; notes: Record<string, string> }) {
        this.refundCalls++;
        const next = this.refundScript.shift();
        if (next instanceof RazorpayError) throw next;
        const refund = { id: `rfnd_${this.refunds.length + 1}`, amount: input.amountPaise, status: this.refundStatus, receipt: input.receipt, notes: input.notes, paymentId: input.paymentId };
        this.refunds.push(refund);
        if (next === 'timeout') throw new RazorpayError('network', 'timed out');
        return refund;
    }

    async listPaymentRefunds(paymentId: string) {
        if (this.unreachable) throw new RazorpayError('network', 'unreachable');
        return this.refunds.filter((r) => r.paymentId === paymentId);
    }

    failCreateOrder = false;
    unreachable = false;

    async createOrder(input: { amountPaise: number; receipt: string; notes: Record<string, string> }) {
        if (this.unreachable) throw new RazorpayError('network', 'unreachable');
        if (this.failCreateOrder) throw new RazorpayError('api', 'order failed', 500);
        const order = { id: `order_${this.orders.length + 1}`, ...input };
        this.orders.push(order);
        return { id: order.id };
    }

    async fetchOrderPayments(orderId: string) {
        if (this.unreachable) throw new RazorpayError('network', 'unreachable');
        return this.payments.get(orderId) ?? [];
    }

    async fetchPayment(paymentId: string) {
        if (this.unreachable) throw new RazorpayError('network', 'unreachable');
        for (const list of this.payments.values()) {
            const found = list.find((p) => p.id === paymentId);
            if (found) return found;
        }
        throw new RazorpayError('api', 'not found', 400);
    }

    captured: string[] = [];
    async capturePayment(paymentId: string, amountPaise: number) {
        const p = await this.fetchPayment(paymentId);
        p.status = 'captured';
        p.amount = amountPaise;
        this.captured.push(paymentId);
        return p;
    }

    addPayment(orderId: string, p: Partial<RazorpayPayment> & { id: string }) {
        const list = this.payments.get(orderId) ?? [];
        list.push({ status: 'captured', amount: 0, currency: 'INR', order_id: orderId, ...p });
        this.payments.set(orderId, list);
    }
}
