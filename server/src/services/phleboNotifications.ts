import { sendTemplateViaWhatsApp } from './wappieWhatsApp';

const WAPPIE_PHLEBO_TEMPLATE_NAME = process.env.WAPPIE_PHLEBO_TEMPLATE_NAME || 'phlebotomist_assigned';
const WAPPIE_PHLEBO_TEMPLATE_LANGUAGE = process.env.WAPPIE_PHLEBO_TEMPLATE_LANGUAGE || 'en';

interface PhleboNotificationPayload {
    mobile: string;
    customerName: string;
    phleboName: string;
    phleboPhone: string;
    expectedArrival: string; // e.g. "15 Jun, 08:00 - 09:00"
}

export async function sendPhleboAssignedViaWhatsApp({
    mobile,
    customerName,
    phleboName,
    phleboPhone,
    expectedArrival,
}: PhleboNotificationPayload) {
    return sendTemplateViaWhatsApp(mobile, WAPPIE_PHLEBO_TEMPLATE_NAME, WAPPIE_PHLEBO_TEMPLATE_LANGUAGE, [
        {
            type: 'body',
            parameters: [
                { type: 'text', text: (customerName || 'Customer').trim() },
                { type: 'text', text: (phleboName || 'Phlebotomist').trim() },
                { type: 'text', text: (phleboPhone || 'N/A').trim() },
                { type: 'text', text: (expectedArrival || 'To be confirmed').trim() },
            ],
        },
    ]);
}
