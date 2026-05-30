'use client';

import { useState, useRef, useCallback } from 'react';
import {
    Upload,
    FileText,
    AlertTriangle,
    CheckCircle2,
    Download,
    Loader2,
    X,
    ArrowRight,
    ArrowUp,
    ArrowDown,
} from 'lucide-react';
import Papa from 'papaparse';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';

// ─── Types ──────────────────────────────────────────────────────────────────

interface PreviewItem {
    id: string;
    name: string;
    type: string;
    currentDisplayPrice: number;
    newDisplayPrice: number;
    currentDiscountedPrice: number | null;
    newDiscountedPrice: number | null;
    changed: boolean;
}

interface ValidationError {
    row: number;
    id: string;
    field: string;
    message: string;
}

interface ValidateResponse {
    summary: {
        totalRows: number;
        validUpdates: number;
        unchanged: number;
        invalid: number;
    };
    preview: PreviewItem[];
    errors: ValidationError[];
}

interface ExecuteResponse {
    success: number;
    failed: number;
    errors: Array<{ id: string; message: string }>;
}

interface CatalogImportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
}

type Step = 'upload' | 'preview' | 'result';

// ─── Header Mapping ─────────────────────────────────────────────────────────

const HEADER_MAP: Record<string, string> = {
    'product id': 'id',
    'productid': 'id',
    'id': 'id',
    'display price': 'displayPrice',
    'displayprice': 'displayPrice',
    'discounted price': 'discountedPrice',
    'discountedprice': 'discountedPrice',
};

function mapHeaders(rawHeaders: string[]): Record<string, string> {
    const mapping: Record<string, string> = {};
    for (const h of rawHeaders) {
        const normalized = h.trim().toLowerCase();
        if (HEADER_MAP[normalized]) {
            mapping[h] = HEADER_MAP[normalized];
        }
    }
    return mapping;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function CatalogImportDialog({ open, onOpenChange, onSuccess }: CatalogImportDialogProps) {
    const [step, setStep] = useState<Step>('upload');
    const [fileName, setFileName] = useState('');
    const [dragging, setDragging] = useState(false);
    const [parsing, setParsing] = useState(false);
    const [validating, setValidating] = useState(false);
    const [executing, setExecuting] = useState(false);
    const [validateResult, setValidateResult] = useState<ValidateResponse | null>(null);
    const [executeResult, setExecuteResult] = useState<ExecuteResponse | null>(null);
    const [parsedRows, setParsedRows] = useState<Array<{ id: string; displayPrice: string; discountedPrice: string }>>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // ── Reset ───────────────────────────────────────────────────────────
    const resetState = useCallback(() => {
        setStep('upload');
        setFileName('');
        setDragging(false);
        setParsing(false);
        setValidating(false);
        setExecuting(false);
        setValidateResult(null);
        setExecuteResult(null);
        setParsedRows([]);
    }, []);

    const handleClose = () => {
        resetState();
        onOpenChange(false);
    };

    // ── Parse CSV ───────────────────────────────────────────────────────
    const processFile = useCallback(async (file: File) => {
        if (!file.name.toLowerCase().endsWith('.csv')) {
            toast.error('Please upload a .csv file');
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            toast.error('File too large. Maximum 5MB allowed.');
            return;
        }

        setFileName(file.name);
        setParsing(true);

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                const rawHeaders = results.meta.fields || [];
                const headerMap = mapHeaders(rawHeaders);

                if (!headerMap[Object.keys(headerMap).find(k => headerMap[k] === 'id') || '']) {
                    // Check if any key maps to 'id'
                    const hasId = Object.values(headerMap).includes('id');
                    const hasPrice = Object.values(headerMap).includes('displayPrice');

                    if (!hasId || !hasPrice) {
                        toast.error('CSV must contain "Product ID" and "Display Price" columns');
                        setParsing(false);
                        return;
                    }
                }

                const rows = (results.data as Record<string, string>[]).map((row) => {
                    const mapped: Record<string, string> = {};
                    for (const [rawKey, value] of Object.entries(row)) {
                        const mappedKey = headerMap[rawKey];
                        if (mappedKey) {
                            mapped[mappedKey] = value?.trim() || '';
                        }
                    }
                    return {
                        id: mapped.id || '',
                        displayPrice: mapped.displayPrice || '',
                        discountedPrice: mapped.discountedPrice || '',
                    };
                }).filter(r => r.id); // Drop rows with empty IDs

                if (rows.length === 0) {
                    toast.error('No valid rows found in CSV');
                    setParsing(false);
                    return;
                }

                setParsedRows(rows);
                setParsing(false);

                // Validate with backend
                setValidating(true);
                try {
                    const res = await api.post('/manager/catalog/import/validate', { rows });
                    setValidateResult(res.data);
                    setStep('preview');
                } catch (error: any) {
                    toast.error(error.response?.data?.error || 'Failed to validate CSV');
                } finally {
                    setValidating(false);
                }
            },
            error: (error) => {
                toast.error(`Failed to parse CSV: ${error.message}`);
                setParsing(false);
            },
        });
    }, []);

    // ── File handlers ───────────────────────────────────────────────────
    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) processFile(file);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) processFile(file);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setDragging(true);
    };

    const handleDragLeave = () => setDragging(false);

    // ── Execute ─────────────────────────────────────────────────────────
    const handleExecute = async () => {
        if (!validateResult) return;

        const updates = validateResult.preview
            .filter(p => p.changed)
            .map(p => ({
                id: p.id,
                displayPrice: p.newDisplayPrice,
                discountedPrice: p.newDiscountedPrice,
            }));

        if (updates.length === 0) {
            toast.error('No changes to apply');
            return;
        }

        setExecuting(true);
        try {
            const res = await api.post('/manager/catalog/import/execute', { updates, filename: fileName });
            setExecuteResult(res.data);
            setStep('result');
            if (res.data.success > 0) {
                toast.success(`${res.data.success} products updated successfully!`);
            }
        } catch (error: any) {
            toast.error(error.response?.data?.error || 'Failed to execute bulk update');
        } finally {
            setExecuting(false);
        }
    };

    // ── Download error report ───────────────────────────────────────────
    const downloadErrorReport = () => {
        if (!validateResult?.errors.length) return;

        const headers = ['Row', 'Product ID', 'Field', 'Error'];
        const rows = validateResult.errors.map(e => [e.row, e.id, e.field, `"${e.message}"`]);
        const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `import-errors-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
    };

    // ── Price change indicator ──────────────────────────────────────────
    const PriceChange = ({ current, next }: { current: number | null; next: number | null }) => {
        const c = current ?? 0;
        const n = next ?? 0;
        if (c === n) return <span className="text-gray-400">—</span>;
        const isUp = n > c;
        return (
            <span className={`inline-flex items-center gap-1 font-medium ${isUp ? 'text-red-600' : 'text-green-600'}`}>
                ₹{c.toLocaleString('en-IN')} → ₹{n.toLocaleString('en-IN')}
                {isUp ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            </span>
        );
    };

    // ── Render ───────────────────────────────────────────────────────────
    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
            <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle>
                        {step === 'upload' && 'Import Catalog CSV'}
                        {step === 'preview' && 'Preview Changes'}
                        {step === 'result' && 'Import Complete'}
                    </DialogTitle>
                    <DialogDescription>
                        {step === 'upload' && 'Upload a CSV file exported from the catalog to update pricing in bulk.'}
                        {step === 'preview' && 'Review the changes below before applying them to the catalog.'}
                        {step === 'result' && 'Your bulk update has been processed.'}
                    </DialogDescription>
                </DialogHeader>

                {/* ── Step 1: Upload ───────────────────────────────────── */}
                {step === 'upload' && (
                    <div className="py-4">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".csv"
                            onChange={handleFileSelect}
                            className="hidden"
                        />

                        <div
                            onDrop={handleDrop}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onClick={() => fileInputRef.current?.click()}
                            className={`relative cursor-pointer rounded-xl border-2 border-dashed p-12 text-center transition-all ${
                                dragging
                                    ? 'border-[#4b2192] bg-purple-50'
                                    : 'border-gray-300 hover:border-[#4b2192] hover:bg-gray-50'
                            }`}
                        >
                            {parsing || validating ? (
                                <div className="flex flex-col items-center gap-3">
                                    <Loader2 className="h-10 w-10 animate-spin text-[#4b2192]" />
                                    <p className="text-sm font-medium text-gray-700">
                                        {parsing ? 'Parsing CSV...' : 'Validating data...'}
                                    </p>
                                    {fileName && (
                                        <p className="text-xs text-gray-500">{fileName}</p>
                                    )}
                                </div>
                            ) : (
                                <div className="flex flex-col items-center gap-3">
                                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-purple-50">
                                        <Upload className="h-6 w-6 text-[#4b2192]" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-gray-700">
                                            Drag & drop your CSV file here
                                        </p>
                                        <p className="mt-1 text-xs text-gray-500">
                                            or click to browse · Max 5MB · .csv only
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="mt-4 rounded-lg bg-gray-50 p-4">
                            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Expected Columns</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                                {['Product ID', 'Display Price', 'Discounted Price (optional)'].map(col => (
                                    <span key={col} className="rounded-full bg-white px-3 py-1 text-xs text-gray-600 border border-gray-200">
                                        {col}
                                    </span>
                                ))}
                            </div>
                            <p className="mt-2 text-xs text-gray-500">
                                Tip: Export your catalog first, edit prices in Excel or Google Sheets, then re-upload.
                            </p>
                        </div>
                    </div>
                )}

                {/* ── Step 2: Preview ──────────────────────────────────── */}
                {step === 'preview' && validateResult && (
                    <div className="flex-1 overflow-hidden flex flex-col gap-4 py-2">
                        {/* Summary bar */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {[
                                { label: 'Total Rows', value: validateResult.summary.totalRows, color: 'text-gray-900' },
                                { label: 'Updates', value: validateResult.summary.validUpdates, color: 'text-blue-700' },
                                { label: 'Unchanged', value: validateResult.summary.unchanged, color: 'text-gray-500' },
                                { label: 'Errors', value: validateResult.summary.invalid, color: validateResult.summary.invalid > 0 ? 'text-red-700' : 'text-gray-500' },
                            ].map(stat => (
                                <div key={stat.label} className="rounded-lg border border-gray-200 bg-white p-3 text-center">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{stat.label}</p>
                                    <p className={`mt-1 text-xl font-bold ${stat.color}`}>{stat.value}</p>
                                </div>
                            ))}
                        </div>

                        {/* Errors section */}
                        {validateResult.errors.length > 0 && (
                            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <AlertTriangle className="h-4 w-4 text-red-600" />
                                        <span className="text-sm font-semibold text-red-800">
                                            {validateResult.errors.length} validation {validateResult.errors.length === 1 ? 'error' : 'errors'}
                                        </span>
                                    </div>
                                    <button
                                        onClick={downloadErrorReport}
                                        className="flex items-center gap-1 rounded-md bg-white px-2.5 py-1 text-xs font-medium text-red-700 border border-red-200 hover:bg-red-50 transition-colors"
                                    >
                                        <Download className="h-3 w-3" />
                                        Download Errors
                                    </button>
                                </div>
                                <div className="mt-2 max-h-24 overflow-y-auto space-y-1">
                                    {validateResult.errors.slice(0, 10).map((err, i) => (
                                        <p key={i} className="text-xs text-red-700">
                                            Row {err.row}: <span className="font-medium">{err.field}</span> — {err.message}
                                        </p>
                                    ))}
                                    {validateResult.errors.length > 10 && (
                                        <p className="text-xs text-red-500 italic">
                                            ...and {validateResult.errors.length - 10} more errors
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Preview table */}
                        {validateResult.preview.filter(p => p.changed).length > 0 ? (
                            <div className="flex-1 overflow-auto rounded-lg border border-gray-200">
                                <table className="w-full text-sm">
                                    <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                                        <tr>
                                            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                                            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                                            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Display Price</th>
                                            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Discounted Price</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {validateResult.preview.filter(p => p.changed).map((item) => (
                                            <tr key={item.id} className="hover:bg-gray-50">
                                                <td className="px-4 py-2.5 text-gray-900 font-medium max-w-[200px] truncate" title={item.name}>
                                                    {item.name}
                                                </td>
                                                <td className="px-4 py-2.5">
                                                    <span className="rounded-full border border-gray-300 px-2 py-0.5 text-xs text-gray-600">
                                                        {item.type}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2.5">
                                                    <PriceChange current={item.currentDisplayPrice} next={item.newDisplayPrice} />
                                                </td>
                                                <td className="px-4 py-2.5">
                                                    <PriceChange current={item.currentDiscountedPrice} next={item.newDiscountedPrice} />
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center py-8 text-center">
                                <FileText className="h-10 w-10 text-gray-300 mb-3" />
                                <p className="text-sm font-medium text-gray-700">No price changes detected</p>
                                <p className="text-xs text-gray-500 mt-1">All values match the current catalog.</p>
                            </div>
                        )}

                        {/* Actions */}
                        <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                            <button
                                onClick={() => { resetState(); }}
                                className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                            >
                                <X className="h-4 w-4" />
                                Cancel
                            </button>
                            <button
                                onClick={handleExecute}
                                disabled={executing || validateResult.summary.validUpdates === 0}
                                className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                style={{ backgroundColor: '#4b2192' }}
                            >
                                {executing ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <CheckCircle2 className="h-4 w-4" />
                                )}
                                {executing ? 'Applying...' : `Confirm & Apply ${validateResult.summary.validUpdates} Updates`}
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Step 3: Result ───────────────────────────────────── */}
                {step === 'result' && executeResult && (
                    <div className="py-6 flex flex-col items-center text-center gap-4">
                        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                            <CheckCircle2 className="h-8 w-8 text-green-600" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-gray-900">
                                {executeResult.success > 0 ? 'Import Successful' : 'Import Complete'}
                            </h3>
                            <p className="mt-1 text-sm text-gray-500">
                                {executeResult.success} product{executeResult.success !== 1 ? 's' : ''} updated
                                {executeResult.failed > 0 && `, ${executeResult.failed} failed`}
                            </p>
                        </div>

                        {executeResult.errors.length > 0 && (
                            <div className="w-full rounded-lg border border-amber-200 bg-amber-50 p-3 text-left">
                                <p className="text-xs font-semibold text-amber-800 uppercase">Failed Updates</p>
                                <div className="mt-1 max-h-24 overflow-y-auto space-y-0.5">
                                    {executeResult.errors.map((err, i) => (
                                        <p key={i} className="text-xs text-amber-700">
                                            {err.id}: {err.message}
                                        </p>
                                    ))}
                                </div>
                            </div>
                        )}

                        <button
                            onClick={() => {
                                handleClose();
                                onSuccess();
                            }}
                            className="flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium text-white transition-colors"
                            style={{ backgroundColor: '#4b2192' }}
                        >
                            Done
                            <ArrowRight className="h-4 w-4" />
                        </button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
