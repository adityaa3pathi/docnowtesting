import Razorpay from 'razorpay';

// Initialize Razorpay lazily
let razorpay: Razorpay;

try {
    if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
        razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET
        });
    } else {
        console.warn('[Razorpay] Warning: RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is missing. Payment routes will fail.');
    }
} catch (err) {
    console.error('[Razorpay] Initialization failed:', err);
}

/**
 * Returns the initialized Razorpay instance.
 * Throws if env vars are missing or initialization failed.
 */
export const getRazorpay = () => {
    if (!razorpay) {
        throw new Error('Razorpay is not initialized. Check server environment variables.');
    }
    return razorpay;
};
