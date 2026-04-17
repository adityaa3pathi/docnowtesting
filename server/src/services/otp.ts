import crypto from 'crypto';
import { prisma } from '../db';
import { sendOtpViaWhatsApp } from './wappieWhatsApp';

export const OTP_EXPIRY_MINS = 10;

export type OtpFlow = 'signup' | 'login' | 'forgot_password' | 'manager_create';

export const isValidMobile = (mobile: string) => /^\d{10}$/.test(mobile);

const generateOTP = () => crypto.randomInt(100000, 999999).toString();

export async function persistAndSendOtp(mobile: string, flow: OtpFlow) {
    const code = generateOTP();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINS * 60 * 1000);

    await prisma.oTP.upsert({
        where: { identifier: mobile },
        update: { code, expiresAt, attempts: 0, updatedAt: new Date() },
        create: { identifier: mobile, code, expiresAt, attempts: 0 }
    });

    try {
        const result = await sendOtpViaWhatsApp(mobile, code);
        console.log(`[AUTH-${flow.toUpperCase()}] OTP accepted by Wappie for ${mobile.slice(-4)} | messageId=${result.id} | status=${result.status}`);
    } catch (error: any) {
        console.error(`[AUTH-${flow.toUpperCase()}] WhatsApp OTP send failed for ${mobile.slice(-4)}:`, error.message);
        throw new Error('We could not send your verification code right now. Please try again.');
    }
}
