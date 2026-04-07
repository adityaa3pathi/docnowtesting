import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimiter';
import { initiatePayment, verifyPayment } from '../controllers/payments';
import { prisma } from '../db';
import { HealthiansAdapter } from '../adapters/healthians';
import { BookingService } from '../services/booking.service';

const router = Router();
const healthians = HealthiansAdapter.getInstance();

// POST /api/payments/initiate - Create Booking + Razorpay Order
router.post('/initiate', authMiddleware, rateLimiter(1, 10, 'initiate'), initiatePayment);

// POST /api/payments/verify - Verify payment + create partner booking
router.post('/verify', authMiddleware, verifyPayment);

// POST /api/payments/validate — Pre-checkout test availability check
// Checks each cart item against Healthians slot availability for the given pincode.
// A date + location with zero slots returned is treated as "unavailable".
router.post('/validate', authMiddleware, async (req: any, res: any) => {
    const { cartId, zipcode, lat, long, date } = req.body;

    if (!cartId || !zipcode) {
        return res.status(400).json({ error: 'cartId and zipcode are required' });
    }

    try {
        const cart = await prisma.cart.findUnique({
            where: { id: cartId },
            include: { items: true }
        });

        if (!cart || cart.items.length === 0) {
            return res.status(404).json({ error: 'Cart not found or empty' });
        }

        const checkDate = date || new Date().toISOString().split('T')[0];
        const bookable: string[] = [];
        const unavailable: Array<{ testCode: string; testName: string }> = [];

        // Fetch zone_id once for the location
        const zoneId = await BookingService.getZoneId(lat || '0', long || '0', zipcode);
        console.log(`[Validate] Using zone_id: ${zoneId} for zipcode: ${zipcode}`);

        // Check all items. Call getSlotsByLocation per item to see if Healthians
        // would accept it.  Empty slots array = location/lab doesn't support this test.
        await Promise.allSettled(cart.items.map(async (item) => {
            try {
                const resp = await healthians.getSlotsByLocation({
                    lat: lat || '0',
                    long: long || '0',
                    zipcode,
                    zone_id: zoneId || '',
                    slot_date: checkDate,
                    amount: item.price,
                    package: [{ deal_id: [item.testCode] }]
                });

                const slots = Array.isArray(resp)
                    ? resp
                    : (resp?.data?.slots || resp?.slots || resp?.data || []);

                if (Array.isArray(slots) && slots.length > 0) {
                    bookable.push(item.testCode);
                } else {
                    unavailable.push({ testCode: item.testCode, testName: item.testName });
                }
            } catch {
                // If the API errors for this item treat it as unavailable
                unavailable.push({ testCode: item.testCode, testName: item.testName });
            }
        }));

        const valid = unavailable.length === 0;
        res.json({ valid, bookable, unavailable });
    } catch (err: any) {
        console.error('[Validate] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// NOTE: Webhook handler is exported from controllers/payments/webhook
// and mounted separately in index.ts (before express.json middleware)

export default router;

