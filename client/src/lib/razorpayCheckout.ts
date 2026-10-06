/** One place that loads Razorpay and opens its checkout. The lab flows keep their own copies. */
declare global {
    interface Window {
        Razorpay?: new (options: Record<string, unknown>) => { open(): void; on(event: string, handler: (res: unknown) => void): void };
    }
}

const SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';

export function loadRazorpay(): Promise<boolean> {
    if (typeof window === 'undefined') return Promise.resolve(false);
    if (window.Razorpay) return Promise.resolve(true);
    return new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = SCRIPT_URL;
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.body.appendChild(script);
    });
}

export interface PaymentResult {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
}

export interface CheckoutOptions {
    keyId: string;
    orderId: string;
    amountPaise: number;
    description: string;
    prefill?: { name?: string; contact?: string; email?: string };
    onPaid: (result: PaymentResult) => void;
    /** The patient closed the popup. Nothing is known about payment from this alone. */
    onDismiss: () => void;
    onFailed: (message: string) => void;
}

/** Opens checkout. Returns false when the Razorpay script could not be loaded. */
export async function openCheckout(opts: CheckoutOptions): Promise<boolean> {
    if (!(await loadRazorpay()) || !window.Razorpay) return false;
    const rzp = new window.Razorpay({
        key: opts.keyId,
        amount: opts.amountPaise,
        currency: 'INR',
        order_id: opts.orderId,
        name: 'DOCNOW',
        description: opts.description,
        prefill: opts.prefill,
        theme: { color: '#4b2192' },
        handler: (res: PaymentResult) => opts.onPaid(res),
        modal: { ondismiss: () => opts.onDismiss() },
    });
    rzp.on('payment.failed', (res: unknown) => {
        const description = (res as { error?: { description?: string } })?.error?.description;
        opts.onFailed(description ?? 'The payment did not go through.');
    });
    rzp.open();
    return true;
}
