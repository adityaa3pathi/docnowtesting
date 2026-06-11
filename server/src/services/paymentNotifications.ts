import { sendTemplateViaWhatsApp } from './wappieWhatsApp';

const WAPPIE_PAYMENT_LINK_TEMPLATE_NAME =
    process.env.WAPPIE_PAYMENT_LINK_TEMPLATE_NAME || 'template_utility_20260605184245';
const WAPPIE_PAYMENT_LINK_TEMPLATE_LANGUAGE =
    process.env.WAPPIE_PAYMENT_LINK_TEMPLATE_LANGUAGE || 'en';

export async function sendPaymentLinkViaWhatsApp(params: {
    mobile: string;
    customerName?: string | null;
    bookingId: string;
    amount: number;
    paymentLink: string;
}) {
    const result = await sendTemplateViaWhatsApp(
        params.mobile,
        WAPPIE_PAYMENT_LINK_TEMPLATE_NAME,
        WAPPIE_PAYMENT_LINK_TEMPLATE_LANGUAGE,
        [
            {
                type: 'body',
                parameters: [
                    {
                        type: 'text',
                        text: (params.customerName || 'Customer').trim(),
                    },
                    {
                        type: 'text',
                        text: params.bookingId,
                    },
                    {
                        type: 'text',
                        text: `${params.amount.toLocaleString('en-IN')}`,
                    },
                    {
                        type: 'text',
                        text: params.paymentLink,
                    },
                ],
            },
        ]
    );

    return result;
}
