import type { CorsOptions } from 'cors';

/** Browsers hide the Date header from cross-origin pages unless it is exposed; the booking countdown needs it. */
export function buildCorsOptions(allowedOrigins: string[]): CorsOptions {
    return {
        origin(origin, callback) {
            if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
            return callback(new Error('Not allowed by CORS'));
        },
        credentials: true,
        exposedHeaders: ['Date'],
    };
}
