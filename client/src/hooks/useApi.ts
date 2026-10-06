'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/lib/consult/api';

/** Loads data on mount and when `deps` change, with loading, error and a refetch. Ignores results after unmount. */
export function useApi<T>(load: () => Promise<T>, deps: unknown[] = []) {
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const alive = useRef(true);
    const run = useRef(load);
    run.current = load;

    const refetch = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await run.current();
            if (alive.current) setData(result);
        } catch (e) {
            if (alive.current) setError(errorMessage(e));
        } finally {
            if (alive.current) setLoading(false);
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
