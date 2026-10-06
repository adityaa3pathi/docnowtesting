import { ConsultRazorpay, RazorpayError, RazorpayPayment } from '../consultations.razorpay';

/** In-memory Razorpay for tests. Set failures and payments directly on the instance. */
export class FakeRazorpay implements ConsultRazorpay {
    orders: { id: string; amountPaise: number; receipt: string; notes: Record<string, string> }[] = [];
    payments = new Map<string, RazorpayPayment[]>();
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

    addPayment(orderId: string, p: Partial<RazorpayPayment> & { id: string }) {
        const list = this.payments.get(orderId) ?? [];
        list.push({ status: 'captured', amount: 0, currency: 'INR', order_id: orderId, ...p });
        this.payments.set(orderId, list);
    }
}
