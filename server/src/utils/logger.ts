import { AsyncLocalStorage } from 'async_hooks';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type RequestLogContext = {
    requestId?: string;
};

type LogMeta = Record<string, unknown>;

const requestContext = new AsyncLocalStorage<RequestLogContext>();

const LOG_LEVELS: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

const configuredLevel = (process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')) as LogLevel;
const minimumLevel = LOG_LEVELS[configuredLevel] ?? LOG_LEVELS.info;

export function withRequestContext<T>(context: RequestLogContext, fn: () => T) {
    return requestContext.run(context, fn);
}

export function getRequestContext() {
    return requestContext.getStore() || {};
}

function serializeError(error: unknown) {
    if (!(error instanceof Error)) return error;

    return {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
    };
}

function sanitizeMeta(meta: LogMeta = {}) {
    const sanitized: LogMeta = {};

    for (const [key, value] of Object.entries(meta)) {
        if (value === undefined) continue;
        sanitized[key] = key === 'error' || key === 'err' ? serializeError(value) : value;
    }

    return sanitized;
}

function safeStringify(payload: LogMeta) {
    const seen = new WeakSet<object>();

    return JSON.stringify(payload, (_key, value) => {
        if (typeof value === 'bigint') return value.toString();
        if (typeof value !== 'object' || value === null) return value;

        if (seen.has(value)) return '[Circular]';
        seen.add(value);
        return value;
    });
}

function writeLog(level: LogLevel, message: string, meta?: LogMeta) {
    if (LOG_LEVELS[level] < minimumLevel) return;

    const payload = {
        level,
        time: new Date().toISOString(),
        message,
        ...getRequestContext(),
        ...sanitizeMeta(meta),
    };

    const line = safeStringify(payload);
    if (level === 'error') {
        process.stderr.write(`${line}\n`);
        return;
    }

    process.stdout.write(`${line}\n`);
}

export const logger = {
    debug: (meta: LogMeta, message = 'debug') => writeLog('debug', message, meta),
    info: (meta: LogMeta, message = 'info') => writeLog('info', message, meta),
    warn: (meta: LogMeta, message = 'warn') => writeLog('warn', message, meta),
    error: (meta: LogMeta, message = 'error') => writeLog('error', message, meta),
};

export function logBusinessEvent(event: string, meta: LogMeta = {}, level: LogLevel = 'info') {
    writeLog(level, event, { event, ...meta });
}

export function logAlert(alert: string, meta: LogMeta = {}) {
    // Alert logs are intentionally structured so CloudWatch/Sentry filters can key off `alert`.
    writeLog('error', alert, { event: 'alert', alert, ...meta });
}
