import dotenv from 'dotenv';
dotenv.config();

import { validateEnv } from './utils/envValidator';
validateEnv();
import { captureObservabilityError, initSentry } from './utils/sentry';
initSentry();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

import { PrismaClient } from '@prisma/client';
import locationRoutes from './routes/location';
import catalogRoutes from './routes/catalog';
import callbackRoutes from './routes/callback';
import corporateInquiryRoutes from './routes/corporateInquiries';
import authRoutes from './routes/auth';
import profileRoutes from './routes/profile';
import patientRoutes from './routes/patients';
import addressRoutes from './routes/addresses';
import cartRoutes from './routes/cart';
import slotRoutes from './routes/slots';
import bookingRoutes from './routes/bookings';
import adminRoutes from './routes/admin';
import paymentRoutes from './routes/payments';
import { webhookHandler } from './controllers/payments';
import { healthiansWebhookHandler } from './controllers/webhooks';
import managerRoutes from './routes/manager';
import promoRoutes from './routes/promos';
import reportRoutes from './routes/reports';
import invoiceRoutes from './routes/invoices';
import healthRoutes from './routes/health';
import { campAdminRoutes, campPublicRoutes } from './modules/camps';
import { registerBookingStrategy } from './services/bookingStrategyRegistry';
import { HomeCollectionStrategy } from './services/homeCollectionStrategy';
import { CampRegistrationStrategy } from './modules/camps';

import { csrfProtection } from './middleware/csrfProtection';
import { legacyCookieCleanup } from './middleware/legacyCookieCleanup';
import { requestContextMiddleware } from './middleware/requestContext';
import { logger } from './utils/logger';

const app = express();
const PORT = process.env.PORT || 5000;

function parseAllowedOrigins() {
    const configured = process.env.CORS_ALLOWED_ORIGINS;
    const defaults = [
        'http://localhost:3000',
        'https://docnow.in',
        'https://www.docnow.in',
    ];

    const origins = configured
        ? configured.split(',').map(origin => origin.trim()).filter(Boolean)
        : defaults;

    if (process.env.APP_BASE_URL) {
        origins.push(process.env.APP_BASE_URL);
    }

    return [...new Set(origins)];
}

const allowedOrigins = parseAllowedOrigins();
app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
}));

app.use(requestContextMiddleware);
app.use(cookieParser());
app.use(legacyCookieCleanup);
app.use(helmet());

// CRITICAL: Webhooks must be mounted BEFORE express.json() to get raw body
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), webhookHandler);
app.post('/api/webhooks/healthians', express.raw({ type: '*/*' }), healthiansWebhookHandler);

app.use(express.json());

// ── UAT Response Logger ─────────────────────────────────
// Intercepts all JSON responses and logs them to the terminal.
// Remove this block after UAT is complete.
app.use((req: any, res: any, next: any) => {
    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
        console.log(`\n${'═'.repeat(60)}`);
        console.log(`[UAT] ${req.method} ${req.originalUrl} → ${res.statusCode}`);
        console.log(`${'─'.repeat(60)}`);
        console.log(JSON.stringify(body, null, 2));
        console.log(`${'═'.repeat(60)}\n`);
        return originalJson(body);
    };
    next();
});

app.use(csrfProtection);

// Register booking strategies at boot
registerBookingStrategy(new HomeCollectionStrategy());
registerBookingStrategy(new CampRegistrationStrategy());

app.use('/health', healthRoutes);
app.use('/api/location', locationRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/callback', callbackRoutes);
app.use('/api/corporate-inquiries', corporateInquiryRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/profile/patients', patientRoutes);
app.use('/api/profile/addresses', addressRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/slots', slotRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/camps', campAdminRoutes);
app.use('/api/manager', managerRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/promos', promoRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/camps', campPublicRoutes);


app.get('/', (req, res) => {
    res.send('DOCNOW API is running');
});

// TEMP: Debug endpoint for IP whitelisting
app.get('/debug/ip', async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(404).json({ error: 'Not found' });
    }

    try {
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        res.json({
            outboundIp: data.ip,
            nodeEnv: process.env.NODE_ENV,
            headers: req.headers
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// export const prisma = new PrismaClient();

import { Request, Response, NextFunction } from 'express';

type RequestWithContext = Request & {
    requestId?: string;
    userId?: string;
};

// GLOBAL ERROR HANDLER FALLBACK
app.use((err: any, req: RequestWithContext, res: Response, next: NextFunction) => {
    const statusCode = err.status || 500;
    logger.error({
        error: err,
        method: req.method,
        path: req.originalUrl || req.url,
        statusCode,
    }, 'unhandled_global_error');

    captureObservabilityError(err, {
        requestId: req.requestId,
        userId: req.userId,
        method: req.method,
        route: req.route?.path,
        path: req.originalUrl || req.url,
        statusCode,
    });

    if (err.message === 'Not allowed by CORS') {
        return res.status(403).json({ error: 'CORS verification failed.' });
    }
    res.status(statusCode).json({
        error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message
    });
});

import { startReconciler } from './workers/reconciler';

app.listen(PORT, () => {
    logger.info({ port: PORT, nodeEnv: process.env.NODE_ENV }, 'server_started');
    startReconciler();
});
