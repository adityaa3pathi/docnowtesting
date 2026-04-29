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
    try {
        let fetchUrl = url;
        if (fetchUrl.startsWith('/') && fetchUrl.startsWith(API_BASE_URL)) {
            fetchUrl = fetchUrl.substring(API_BASE_URL.length);
        }
        // Ensure fetchUrl starts with / if we just stripped the base url
        if (!fetchUrl.startsWith('http') && !fetchUrl.startsWith('/')) {
            fetchUrl = '/' + fetchUrl;
        }

        const response = await api.get(fetchUrl, { responseType: 'blob' });
        
        const blob = response.data;
        const objectUrl = window.URL.createObjectURL(blob);
        const filename = getFilenameFromDisposition(
            response.headers['content-disposition'],
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
    } catch (error: any) {
        let message = 'Failed to download file.';
        if (error.response?.data instanceof Blob) {
            try {
                const text = await error.response.data.text();
                const payload = JSON.parse(text);
                message = payload.error || message;
            } catch { /* ignore */ }
        } else if (error.response?.data?.error) {
            message = error.response.data.error;
        } else if (error.message) {
            message = error.message;
        }
        throw new Error(message);
    }
}

// --- In-memory token store ---
let accessToken: string | null = null;
export const getAccessToken = () => accessToken;
export const setAccessToken = (t: string | null) => { accessToken = t; };

const api = axios.create({
    baseURL: API_BASE_URL,
    withCredentials: true,
    headers: {
        'Content-Type': 'application/json',
        'X-Client-Type': 'web',
    },
});

// Request interceptor to attach token and CSRF
api.interceptors.request.use((config) => {
    if (accessToken) {
        config.headers.Authorization = `Bearer ${accessToken}`;
    }
    
    // CSRF protection for state-changing requests
    if (config.method !== 'get' && typeof document !== 'undefined') {
        const csrf = document.cookie.match(/docnow_csrf=([^;]+)/)?.[1];
        if (csrf) {
            config.headers['x-docnow-csrf'] = csrf;
        }
    }
    return config;
}, (error) => {
    return Promise.reject(error);
});

// Response interceptor — graceful handling of network errors & silent refresh
let refreshPromise: Promise<any> | null = null;

api.interceptors.response.use(
    (response) => response,
    async (error) => {
        if (!error.response) {
            console.warn('[API] Network error:', error.message || 'Server unreachable');
            return Promise.reject({
                message: 'Unable to reach the server. Please check your connection.',
                isNetworkError: true,
                originalError: error,
            });
        }

        // Silent refresh on 401
        if (error.response.status === 401 && !error.config._retry && error.config.url !== '/auth/refresh') {
            error.config._retry = true;

            if (!refreshPromise) {
                refreshPromise = api.post('/auth/refresh')
                    .then(r => r.data)
                    .catch(() => null)
                    .finally(() => { refreshPromise = null; });
            }

            const data = await refreshPromise;
            if (!data) {
                accessToken = null;
                if (typeof window !== 'undefined') {
                    if (window.location.pathname !== '/') {
                        window.location.href = '/?login=true';
                    }
                }
                return Promise.reject(error);
            }

            if (data.accessToken) {
                accessToken = data.accessToken;
            }

            // Retry original request
            error.config.headers.Authorization = `Bearer ${accessToken}`;
            return api(error.config);
        }

        return Promise.reject(error);
    }
);

export default api;
