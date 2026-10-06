'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/lib/consult/api';

/** Loads data on mount and when `deps` change, with loading, error and a refetch. Ignores results after unmount or when a newer request started. */
export function useApi<T>(load: () => Promise<T>, deps: unknown[] = []) {
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const alive = useRef(true);
    const run = useRef(load);
    const latest = useRef(0);
    run.current = load;

    const refetch = useCallback(async () => {
        setLoading(true);
        setError(null);
        const mine = ++latest.current;
        const current = () => alive.current && mine === latest.current;
        try {
            const result = await run.current();
            if (current()) setData(result);
        } catch (e) {
            if (current()) setError(errorMessage(e));
        } finally {
            if (current()) setLoading(false);
        }
    }, []);

    useEffect(() => {
        alive.current = true;
        void refetch();
        return () => {
            alive.current = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);

    return { data, error, loading, refetch, setData };
}
