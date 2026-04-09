import axios from 'axios';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api';
export const APP_BASE_URL = API_BASE_URL.endsWith('/api')
    ? API_BASE_URL.slice(0, -4)
    : API_BASE_URL;

export function getApiUrl(path: string) {
    return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export function getAppUrl(path: string) {
    if (APP_BASE_URL) {
        return `${APP_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
    }
    return path.startsWith('/') ? path : `/${path}`;
}

function getFilenameFromDisposition(contentDisposition: string | null, fallback: string) {
    if (!contentDisposition) return fallback;

    const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
        return decodeURIComponent(utf8Match[1]);
    }

    const plainMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
    return plainMatch?.[1] || fallback;
}

export async function downloadAuthenticatedFile(url: string, fallbackFilename = 'download.pdf') {
    const token = typeof window !== 'undefined' ? localStorage.getItem('docnow_auth_token') : null;
    if (!token) {
        throw new Error('Please sign in again to download this report.');
    }

    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });

    if (!response.ok) {
        let message = 'Failed to download file.';
        try {
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                const payload = await response.json();
                message = payload.error || message;
            } else {
                const text = await response.text();
                if (text) message = text;
            }
        } catch {
            // ignore parsing failure and keep generic message
        }
        throw new Error(message);
    }

    const blob = await response.blob();
    const objectUrl = window.URL.createObjectURL(blob);
    const filename = getFilenameFromDisposition(
        response.headers.get('content-disposition'),
        fallbackFilename
    );

    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    window.setTimeout(() => {
        window.URL.revokeObjectURL(objectUrl);
    }, 1000);
}

const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Add a request interceptor to attach the token
api.interceptors.request.use((config) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('docnow_auth_token') : null;
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
}, (error) => {
    return Promise.reject(error);
});

// Response interceptor — graceful handling of network errors
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (!error.response) {
            // Network error (server unreachable, DNS fail, CORS, etc.)
            console.warn('[API] Network error:', error.message || 'Server unreachable');
            // Return a rejected promise with a clean error object
            // so callers can handle it without Next.js showing the raw overlay
            return Promise.reject({
                message: 'Unable to reach the server. Please check your connection.',
                isNetworkError: true,
                originalError: error,
            });
        }
        return Promise.reject(error);
    }
);

export default api;
