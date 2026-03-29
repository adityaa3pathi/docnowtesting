import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimiter';
import { initiatePayment, verifyPayment } from '../controllers/payments';

const router = Router();

// POST /api/payments/initiate - Create Booking + Razorpay Order
router.post('/initiate', authMiddleware, rateLimiter(1, 10, 'initiate'), initiatePayment);

// POST /api/payments/verify - Verify payment + create partner booking
router.post('/verify', authMiddleware, verifyPayment);

// NOTE: Webhook handler is exported from controllers/payments/webhook
// and mounted separately in index.ts (before express.json middleware)

export default router;
