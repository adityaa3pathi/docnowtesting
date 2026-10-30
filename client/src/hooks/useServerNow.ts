'use client';
import { useEffect, useState } from 'react';
import { serverNow } from '@/lib/consult/time';

/** The server's clock, re-read every `intervalMs`, so time-based buttons appear without a reload. */
export function useServerNow(intervalMs = 15_000): number {
    const [now, setNow] = useState(() => serverNow());
    useEffect(() => {
        const t = setInterval(() => setNow(serverNow()), intervalMs);
        return () => clearInterval(t);
    }, [intervalMs]);
    return now;
}
