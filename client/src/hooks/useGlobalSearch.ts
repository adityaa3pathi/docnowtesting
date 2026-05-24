import { useState, useEffect } from 'react';
import api from '@/lib/api';

export interface SearchResultItem {
    id: string;
    partnerCode: string;
    name: string;
    type: string;
    displayPrice: number;
    price: number;
    mrp?: number | null;
    categories: { id: string; name: string; slug: string }[];
}

export function useGlobalSearch(query: string) {
    const [results, setResults] = useState<SearchResultItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isError, setIsError] = useState(false);

    useEffect(() => {
        if (!query.trim()) {
            setResults([]);
            setIsError(false);
            return;
        }

        let isMounted = true;
        const fetchResults = async () => {
            setIsLoading(true);
            setIsError(false);
            try {
                const res = await api.get('/catalog/products', {
                    params: { search: query.trim(), limit: 6 }
                });
                if (isMounted && res.data?.products) {
                    setResults(res.data.products);
                }
            } catch (err) {
                console.error('Search error:', err);
                if (isMounted) setIsError(true);
            } finally {
                if (isMounted) setIsLoading(false);
            }
        };

        fetchResults();

        return () => {
            isMounted = false;
        };
    }, [query]);

    return { results, isLoading, isError };
}
