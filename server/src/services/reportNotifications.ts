import { sendTemplateViaWhatsApp } from './wappieWhatsApp';

const WAPPIE_REPORT_TEMPLATE_NAME = process.env.WAPPIE_REPORT_TEMPLATE_NAME || 'template_marketing_20260401171046';
const WAPPIE_REPORT_TEMPLATE_LANGUAGE = process.env.WAPPIE_REPORT_TEMPLATE_LANGUAGE || 'en';
const APP_BASE_URL = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/g, '');

interface ReportReadyPayload {
    mobile: string;
    customerName?: string | null;
    reportLabel: string;
    reportLink?: string;
}

function buildReportLink(providedLink?: string) {
    if (providedLink) {
        return providedLink;
    }
    return `${APP_BASE_URL}/profile?tab=reports`;
}

export async function sendReportReadyViaWhatsApp({
    mobile,
    customerName,
    reportLabel,
    reportLink,
}: ReportReadyPayload) {
    return sendTemplateViaWhatsApp(mobile, WAPPIE_REPORT_TEMPLATE_NAME, WAPPIE_REPORT_TEMPLATE_LANGUAGE, [
        {
            type: 'body',
            parameters: [
                {
                    type: 'text',
                    text: (customerName || 'Customer').trim(),
                },
                {
                    type: 'text',
                    text: reportLabel,
                },
                {
                    type: 'text',
                    text: buildReportLink(reportLink),
                },
            ],
        },
    ]);
}
