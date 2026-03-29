import axios from 'axios';

const api = axios.create({
    baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api', // Backend URL
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
