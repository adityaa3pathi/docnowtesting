import { useState } from 'react';
import toast from 'react-hot-toast';

export function useExport() {
    const [exporting, setExporting] = useState(false);

    const exportCsv = async (entity: string, params: Record<string, string>) => {
        setExporting(true);
        try {
            const token = localStorage.getItem('docnow_auth_token');
            const searchParams = new URLSearchParams(params);
            searchParams.set('entity', entity);

            const url = `/api/admin/export?${searchParams.toString()}`;
            
            const reqUrl = process.env.NEXT_PUBLIC_API_URL 
                ? `${process.env.NEXT_PUBLIC_API_URL.replace('/api', '')}${url}` 
                : url.startsWith('/api') ? `http://localhost:5000${url}` : url; // fallback for standalone hook

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
