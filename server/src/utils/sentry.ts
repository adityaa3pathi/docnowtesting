import * as Sentry from '@sentry/node';

type ObservabilityMeta = Record<string, unknown>;

let sentryEnabled = false;

const SENSITIVE_KEY_PATTERN = /(token|secret|password|signature|authorization|cookie|otp|report_url|sourceUrl|rawPayload)/i;

function sanitizeValue(key: string, value: unknown): unknown {
    if (value === undefined) return undefined;
    if (SENSITIVE_KEY_PATTERN.test(key)) return '[redacted]';
    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
        };
    }
    if (typeof value === 'object' && value !== null) {
        if (Array.isArray(value)) return value.slice(0, 20).map((item, index) => sanitizeValue(`${key}.${index}`, item));

        const sanitized: ObservabilityMeta = {};
        for (const [childKey, childValue] of Object.entries(value as ObservabilityMeta)) {
            const cleaned = sanitizeValue(childKey, childValue);
            if (cleaned !== undefined) sanitized[childKey] = cleaned;
        }
        return sanitized;
    }
    return value;
}

export function sanitizeForObservability(meta: ObservabilityMeta = {}) {
    const sanitized: ObservabilityMeta = {};
    for (const [key, value] of Object.entries(meta)) {
        const cleaned = sanitizeValue(key, value);
        if (cleaned !== undefined) sanitized[key] = cleaned;
    }
    return sanitized;
}

function extractTags(meta: ObservabilityMeta = {}) {
    const tagKeys = ['requestId', 'event', 'alert', 'bookingId', 'partnerBookingId', 'source', 'eventType', 'statusCode'];
    const tags: Record<string, string> = {};

    for (const key of tagKeys) {
        const value = meta[key];
        if (value !== undefined && value !== null) tags[key] = String(value).slice(0, 200);
    }

    return tags;
}

export function initSentry() {
    const dsn = process.env.SENTRY_DSN;
    if (!dsn) return false;

    Sentry.init({
        dsn,
        environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
        release: process.env.SENTRY_RELEASE,
        tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
        beforeSend(event) {
            if (event.request?.cookies) delete event.request.cookies;
            if (event.request?.headers) {
                delete event.request.headers.authorization;
                delete event.request.headers.cookie;
                delete event.request.headers['x-razorpay-signature'];
                delete event.request.headers['x-healthians-secret'];
            }
            return event;
        },
    });

    sentryEnabled = true;
    return true;
}

export function isSentryEnabled() {
    return sentryEnabled;
}

export function addObservabilityBreadcrumb(message: string, meta: ObservabilityMeta = {}) {
    if (!sentryEnabled) return;

    Sentry.addBreadcrumb({
        message,
        category: 'docnow',
        level: 'info',
        data: sanitizeForObservability(meta),
    });
}

export function captureObservabilityError(error: unknown, meta: ObservabilityMeta = {}) {
    if (!sentryEnabled) return;

    Sentry.withScope((scope) => {
        const sanitized = sanitizeForObservability(meta);
        scope.setTags(extractTags(sanitized));
        scope.setContext('docnow', sanitized);
        Sentry.captureException(error instanceof Error ? error : new Error(String(error || 'Unknown error')));
    });
}

export function captureObservabilityMessage(message: string, meta: ObservabilityMeta = {}) {
    if (!sentryEnabled) return;

    Sentry.withScope((scope) => {
        const sanitized = sanitizeForObservability(meta);
        scope.setTags(extractTags(sanitized));
        scope.setContext('docnow', sanitized);
        Sentry.captureMessage(message, 'error');
    });
}
