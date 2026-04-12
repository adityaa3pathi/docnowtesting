import axios from 'axios';

const WAPPIE_API_URL = process.env.WAPPIE_API_URL || 'https://api.wappie.in/v2/whatsapp/messages/sendDirectly';
const WAPPIE_API_KEY = process.env.WAPPIE_API_KEY;
const WAPPIE_WHATSAPP_FROM = process.env.WAPPIE_WHATSAPP_FROM;
const WAPPIE_OTP_TEMPLATE_NAME = process.env.WAPPIE_OTP_TEMPLATE_NAME || 'otp_authentication';
const WAPPIE_OTP_TEMPLATE_LANGUAGE = process.env.WAPPIE_OTP_TEMPLATE_LANGUAGE || 'en';

export interface WappieSendResult {
    id: string;
    wamid?: string;
    status: string;
    pricingCategory?: string;
}

export interface WappieTemplateParameter {
    type: 'text';
    text: string;
}

export interface WappieTemplateComponent {
    type: 'body' | 'button';
    parameters?: WappieTemplateParameter[];
    sub_type?: 'url';
    index?: string;
}

function assertWappieConfig() {
    if (!WAPPIE_API_KEY) {
        throw new Error('Wappie API key is not configured');
    }
    if (!WAPPIE_WHATSAPP_FROM) {
        throw new Error('Wappie sender number is not configured');
    }
}

export function formatIndianWhatsAppNumber(mobile: string): string {
    const digits = mobile.replace(/\D/g, '');
    if (digits.length === 10) return `+91${digits}`;
    if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
    if (digits.length === 13 && digits.startsWith('091')) return `+${digits.slice(1)}`;
    if (mobile.startsWith('+') && digits.length >= 10) return mobile;
    throw new Error('Invalid Indian mobile number for WhatsApp delivery');
}

export async function sendTemplateViaWhatsApp(
    mobile: string,
    templateName: string,
    languageCode: string,
    components: WappieTemplateComponent[]
): Promise<WappieSendResult> {
    assertWappieConfig();

    const to = formatIndianWhatsAppNumber(mobile);

    const payload = {
        from: WAPPIE_WHATSAPP_FROM,
        to,
        type: 'template',
        template: {
            name: templateName,
            language: {
                code: languageCode,
                policy: 'deterministic',
            },
            components,
        },
    };

    try {
        const response = await axios.post<WappieSendResult>(WAPPIE_API_URL, payload, {
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': WAPPIE_API_KEY,
            },
            timeout: 15000,
        });

        return response.data;
    } catch (error: any) {
        const providerMessage =
            error?.response?.data?.error?.message ||
            error?.response?.data?.message ||
            error?.message ||
            'Unknown WhatsApp delivery error';
        throw new Error(providerMessage);
    }
}

export async function sendOtpViaWhatsApp(mobile: string, otp: string): Promise<WappieSendResult> {
    return sendTemplateViaWhatsApp(mobile, WAPPIE_OTP_TEMPLATE_NAME, WAPPIE_OTP_TEMPLATE_LANGUAGE, [
        {
            type: 'body',
            parameters: [
                {
                    type: 'text',
                    text: otp,
                },
            ],
        },
        {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [
                {
                    type: 'text',
                    text: otp,
                },
            ],
        },
    ]);
}
