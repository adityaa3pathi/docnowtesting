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

    /** Order ids whose payment lookup should fail, to prove one bad row does not stop a batch. */
    failOrderLookups = new Set<string>();

    async fetchRefund(paymentId: string, refundId: string) {
        if (this.unreachable) throw new RazorpayError('network', 'unreachable');
        const found = this.refunds.find((r) => r.paymentId === paymentId && r.id === refundId);
        if (!found) throw new RazorpayError('api', 'not found', 400);
        return found;
    }

    async findOrderByReceipt(receipt: string) {
        if (this.unreachable) throw new RazorpayError('network', 'unreachable');
        const order = this.orders.find((o) => o.receipt === receipt);
        return order ? { id: order.id, amount: order.amountPaise } : null;
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

    orderLookups = 0;

    async fetchOrderPayments(orderId: string) {
        this.orderLookups++;
        if (this.unreachable) throw new RazorpayError('network', 'unreachable');
        if (this.failOrderLookups.has(orderId)) throw new RazorpayError('api', 'lookup failed', 400);
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
