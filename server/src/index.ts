import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

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




const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = process.env.APP_BASE_URL ? [process.env.APP_BASE_URL, 'http://localhost:3000'] : ['http://localhost:3000'];
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
}));
app.use(helmet());
app.use(morgan('dev'));

// CRITICAL: Webhooks must be mounted BEFORE express.json() to get raw body
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), webhookHandler);
app.post('/api/webhooks/healthians', express.raw({ type: '*/*' }), healthiansWebhookHandler);

app.use(express.json());

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
console.log('Mounting /api/bookings. bookingRoutes type:', typeof bookingRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/manager', managerRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/promos', promoRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/invoices', invoiceRoutes);

app.get('/', (req, res) => {
    res.send('DOCNOW API is running');
});

// TEMP: Debug endpoint for IP whitelisting
app.get('/debug/ip', async (req, res) => {
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

// GLOBAL ERROR HANDLER FALLBACK
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error('Unhandled Global Error Encountered:', err);
    if (err.message === 'Not allowed by CORS') {
        return res.status(403).json({ error: 'CORS verification failed.' });
    }
    res.status(err.status || 500).json({
        error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message
    });
});

import { startReconciler } from './workers/reconciler';

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    startReconciler();
});
