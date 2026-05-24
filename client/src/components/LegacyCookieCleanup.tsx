'use client';

import { useEffect } from 'react';

/**
 * One-time client-side cleanup of stale cookies.
 * 
 * Before NODE_ENV=production was set, cookies were created without
 * a domain attribute. The server-side cleanup can't always delete
 * them because the browser may not match the Set-Cookie attributes.
 * 
 * This script runs once on the client, forcefully deletes all
 * docnow_* cookies for every possible domain/path combo, then sets
 * a localStorage flag so it never runs again.
 * 
 * Safe to remove after June 15, 2026.
 */
export function LegacyCookieCleanup() {
    useEffect(() => {
        const CLEANUP_KEY = 'docnow_cookie_cleanup_v1';

        // Skip if already cleaned
        if (typeof window === 'undefined') return;
        if (localStorage.getItem(CLEANUP_KEY)) return;

        // Delete a cookie by setting it expired for various domain/path combos
        const cookieNames = ['docnow_access', 'docnow_refresh', 'docnow_csrf'];
        const paths = ['/', '/api', '/api/auth'];
        const domains = ['', 'docnow.in', '.docnow.in', 'api.docnow.in'];

        for (const name of cookieNames) {
            for (const path of paths) {
                // Without domain
                document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${path}`;
                // With each domain
                for (const domain of domains) {
                    if (domain) {
                        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${path}; domain=${domain}`;
                    }
                }
            }
        }

        // Mark as done
        localStorage.setItem(CLEANUP_KEY, Date.now().toString());
    }, []);

    return null;
}
