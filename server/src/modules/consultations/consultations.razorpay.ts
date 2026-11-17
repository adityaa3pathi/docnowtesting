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

const DEFAULT_TIMEOUT_MS = 10_000;
const MONEY_TIMEOUT_MS = 15_000;

/** The SDK has no timeout, so a hung Razorpay call would stall the request or the repair job. */
export async function withTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new RazorpayError('network', 'Razorpay request timed out')), ms);
    });
    try {
        return await Promise.race([fn(), timeout]);
    } finally {
        clearTimeout(timer);
    }
}

export type RazorpayPayment = { id: string; status: string; amount: number; currency: string; order_id: string };

export type RazorpayRefund = { id: string; amount: number; status: string; receipt?: string | null; notes?: Record<string, string> | null };

export interface ConsultRazorpay {
    createOrder(input: { amountPaise: number; receipt: string; notes: Record<string, string> }): Promise<{ id: string }>;
    fetchOrderPayments(orderId: string): Promise<RazorpayPayment[]>;
    fetchPayment(paymentId: string): Promise<RazorpayPayment>;
    createRefund(input: { paymentId: string; amountPaise: number; receipt: string; notes: Record<string, string> }): Promise<RazorpayRefund>;
    listPaymentRefunds(paymentId: string): Promise<RazorpayRefund[]>;
    fetchRefund(paymentId: string, refundId: string): Promise<RazorpayRefund>;
    /** Finds an order by the receipt we stored before creating it. */
    findOrderByReceipt(receipt: string): Promise<{ id: string; amount: number } | null>;
    /** Only needed when the account does not auto-capture. */
    capturePayment(paymentId: string, amountPaise: number): Promise<RazorpayPayment>;
}

export function realConsultRazorpay(): ConsultRazorpay {
    return {
        async createOrder({ amountPaise, receipt, notes }) {
            try {
                const order = await withTimeout(() => getRazorpay().orders.create({ amount: amountPaise, currency: 'INR', receipt, notes }), DEFAULT_TIMEOUT_MS);
                return { id: order.id };
            } catch (e) {
                throw normalizeRazorpayError(e);
            }
        },
        async fetchOrderPayments(orderId) {
            try {
                const res = await withTimeout(() => getRazorpay().orders.fetchPayments(orderId), DEFAULT_TIMEOUT_MS);
                return (res.items ?? []) as unknown as RazorpayPayment[];
            } catch (e) {
                throw normalizeRazorpayError(e);
            }
        },
        async createRefund({ paymentId, amountPaise, receipt, notes }) {
            try {
                return (await withTimeout(() => getRazorpay().payments.refund(paymentId, { amount: amountPaise, receipt, notes } as any), MONEY_TIMEOUT_MS)) as unknown as RazorpayRefund;
            } catch (e) {
                throw normalizeRazorpayError(e);
            }
        },
        async listPaymentRefunds(paymentId) {
            try {
                const res = await withTimeout(() => getRazorpay().payments.fetchMultipleRefund(paymentId), DEFAULT_TIMEOUT_MS);
                return (res.items ?? []) as unknown as RazorpayRefund[];
            } catch (e) {
                throw normalizeRazorpayError(e);
            }
        },
        async fetchRefund(paymentId, refundId) {
            try {
                return (await withTimeout(() => getRazorpay().payments.fetchRefund(paymentId, refundId), DEFAULT_TIMEOUT_MS)) as unknown as RazorpayRefund;
            } catch (e) {
                throw normalizeRazorpayError(e);
            }
        },
        async findOrderByReceipt(receipt) {
            try {
                const res = await withTimeout(() => getRazorpay().orders.all({ receipt } as any), DEFAULT_TIMEOUT_MS);
                const order = (res.items ?? [])[0] as { id: string; amount: number } | undefined;
                return order ? { id: order.id, amount: order.amount } : null;
            } catch (e) {
                throw normalizeRazorpayError(e);
            }
        },
        async fetchPayment(paymentId) {
            try {
                return (await withTimeout(() => getRazorpay().payments.fetch(paymentId), DEFAULT_TIMEOUT_MS)) as unknown as RazorpayPayment;
            } catch (e) {
                throw normalizeRazorpayError(e);
            }
        },
        async capturePayment(paymentId, amountPaise) {
            try {
                return (await withTimeout(() => getRazorpay().payments.capture(paymentId, amountPaise, 'INR'), MONEY_TIMEOUT_MS)) as unknown as RazorpayPayment;
            } catch (e) {
                throw normalizeRazorpayError(e);
            }
        },
    };
}
