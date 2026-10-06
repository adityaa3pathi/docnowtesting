/**
 * The Razorpay calls the consultation module needs, behind one interface so tests can fake it.
 * SDK errors are plain objects and network failures throw a TypeError, so both are normalised here.
 */
import { getRazorpay } from '../../services/razorpay';

export class RazorpayError extends Error {
    constructor(public kind: 'api' | 'network', message: string, public status?: number, public code?: string) {
        super(message);
    }
}

export function normalizeRazorpayError(e: unknown): RazorpayError {
    if (e instanceof RazorpayError) return e;
    const err = e as { statusCode?: number; error?: { code?: string; description?: string } } | undefined;
    if (err && typeof err === 'object' && !(e instanceof Error) && (err.statusCode || err.error)) {
        return new RazorpayError('api', err.error?.description || 'Razorpay request failed', err.statusCode, err.error?.code);
    }
    return new RazorpayError('network', e instanceof Error ? e.message : 'Razorpay unreachable');
}

export type RazorpayPayment = { id: string; status: string; amount: number; currency: string; order_id: string };

export interface ConsultRazorpay {
    createOrder(input: { amountPaise: number; receipt: string; notes: Record<string, string> }): Promise<{ id: string }>;
    fetchOrderPayments(orderId: string): Promise<RazorpayPayment[]>;
    fetchPayment(paymentId: string): Promise<RazorpayPayment>;
    /** Only needed when the account does not auto-capture. */
    capturePayment(paymentId: string, amountPaise: number): Promise<RazorpayPayment>;
}

export function realConsultRazorpay(): ConsultRazorpay {
    return {
        async createOrder({ amountPaise, receipt, notes }) {
            try {
                const order = await getRazorpay().orders.create({ amount: amountPaise, currency: 'INR', receipt, notes });
                return { id: order.id };
            } catch (e) {
                throw normalizeRazorpayError(e);
            }
        },
        async fetchOrderPayments(orderId) {
            try {
                const res = await getRazorpay().orders.fetchPayments(orderId);
                return (res.items ?? []) as unknown as RazorpayPayment[];
            } catch (e) {
                throw normalizeRazorpayError(e);
            }
        },
        async fetchPayment(paymentId) {
            try {
                return (await getRazorpay().payments.fetch(paymentId)) as unknown as RazorpayPayment;
            } catch (e) {
                throw normalizeRazorpayError(e);
            }
        },
        async capturePayment(paymentId, amountPaise) {
            try {
                return (await getRazorpay().payments.capture(paymentId, amountPaise, 'INR')) as unknown as RazorpayPayment;
            } catch (e) {
                throw normalizeRazorpayError(e);
            }
        },
    };
}
