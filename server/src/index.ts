import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import locationRoutes from './routes/location';
import catalogRoutes from './routes/catalog';
import userRoutes from './routes/user';
import callbackRoutes from './routes/callback';
import authRoutes from './routes/auth';
import profileRoutes from './routes/profile';
import patientRoutes from './routes/patients';
import addressRoutes from './routes/addresses';
import cartRoutes from './routes/cart';
import slotRoutes from './routes/slots';
import bookingRoutes from './routes/bookings';
import adminRoutes from './routes/admin';
import paymentRoutes, { webhookHandler } from './routes/payments';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(helmet());
app.use(morgan('dev'));

// CRITICAL: Webhook must be mounted BEFORE express.json() to get raw body
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), webhookHandler);

app.use(express.json());

app.use('/api/location', locationRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/users', userRoutes);
app.use('/api/callback', callbackRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/profile/patients', patientRoutes);
app.use('/api/profile/addresses', addressRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/slots', slotRoutes);
console.log('Mounting /api/bookings. bookingRoutes type:', typeof bookingRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payments', paymentRoutes);

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

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
