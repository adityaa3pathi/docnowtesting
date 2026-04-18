import { createInvoiceAccessToken } from './invoiceAccess';
import { sendTemplateViaWhatsApp } from './wappieWhatsApp';

const WAPPIE_INVOICE_TEMPLATE_NAME = process.env.WAPPIE_INVOICE_TEMPLATE_NAME || 'invoice_ready';
const WAPPIE_INVOICE_TEMPLATE_LANGUAGE = process.env.WAPPIE_INVOICE_TEMPLATE_LANGUAGE || 'en';
const APP_BASE_URL = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/g, '');

function buildInvoiceLink(token: string) {
    return `${APP_BASE_URL}/api/invoices/public/${token}`;
}

export async function sendInvoiceViaWhatsApp(params: {
    bookingId: string;
    mobile: string;
    customerName?: string | null;
    invoiceLabel: string;
}) {
    const token = createInvoiceAccessToken(params.bookingId);
    const invoiceLink = buildInvoiceLink(token);

    const result = await sendTemplateViaWhatsApp(
        params.mobile,
        WAPPIE_INVOICE_TEMPLATE_NAME,
        WAPPIE_INVOICE_TEMPLATE_LANGUAGE,
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
                        text: params.invoiceLabel,
                    },
                    {
                        type: 'text',
                        text: invoiceLink,
                    },
                ],
            },
        ]
    );

    return {
        ...result,
        invoiceLink,
    };
}
