import { useState } from 'react';
import toast from 'react-hot-toast';
import { getAppUrl } from '@/lib/api';

export function useExport() {
    const [exporting, setExporting] = useState(false);

    const exportCsv = async (entity: string, params: Record<string, string>, apiPrefix: '/api/admin' | '/api/manager' = '/api/admin') => {
        setExporting(true);
        try {
            const token = localStorage.getItem('docnow_auth_token');
            const filteredParams = Object.fromEntries(
                Object.entries(params).filter(([, value]) => value !== '')
            );
            const searchParams = new URLSearchParams(filteredParams);
            searchParams.set('entity', entity);

            const url = `${apiPrefix}/export?${searchParams.toString()}`;
            const reqUrl = getAppUrl(url);

            const res = await fetch(reqUrl, {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            });

            if (!res.ok) {
                throw new Error('Failed to export data');
            }

            const blob = await res.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = `${entity}-export-${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            
            // Clean up
            window.URL.revokeObjectURL(downloadUrl);
            document.body.removeChild(a);
            
            toast.success(`${entity} exported successfully!`);
        } catch (error: any) {
            console.error('Export error:', error);
            toast.error(error.message || 'Failed to export CSV');
        } finally {
            setExporting(false);
        }
    };

    return {
        exporting,
        exportCsv
    };
}
