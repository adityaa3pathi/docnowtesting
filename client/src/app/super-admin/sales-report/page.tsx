'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    BarChart3,
    Calendar,
    Download,
    Loader2,
    MapPin,
    RefreshCw,
    Search,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useExport } from '@/hooks/useExport';
import api from '@/lib/api';

interface SalesReportRow {
    date: string;
    totalTestsBooked: number;
    totalTestsDone: number;
    testsBounced: number;
    revenueCollected: number;
    averageOrderValue: number;
    totalPatients: number;
    repeatPatients: number;
    newPatients: number;
}

function getErrorMessage(error: unknown) {
    if (typeof error === 'object' && error !== null && 'response' in error) {
        const response = (error as { response?: { data?: { error?: string } } }).response;
        if (response?.data?.error) return response.data.error;
    }
    if (error instanceof Error) return error.message;
    return 'Failed to load sales report';
}

function toDateInputValue(date: Date) {
    return date.toISOString().slice(0, 10);
}

function formatDate(date: string) {
    return new Date(`${date}T00:00:00+05:30`).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}

function formatCurrency(value: number) {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
    }).format(value);
}

export default function SalesReportPage() {
    const today = useMemo(() => new Date(), []);
    const thirtyDaysAgo = useMemo(() => {
        const date = new Date();
        date.setDate(date.getDate() - 29);
        return date;
    }, []);

    const [rows, setRows] = useState<SalesReportRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [dateFrom, setDateFrom] = useState(toDateInputValue(thirtyDaysAgo));
    const [dateTo, setDateTo] = useState(toDateInputValue(today));
    const [city, setCity] = useState('');
    const [cityFilter, setCityFilter] = useState('');

    const { exporting, exportCsv } = useExport();

    const fetchReport = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (dateFrom) params.set('dateFrom', dateFrom);
            if (dateTo) params.set('dateTo', dateTo);
            if (cityFilter) params.set('city', cityFilter);

            const res = await api.get(`/admin/sales-report?${params.toString()}`);
            setRows(res.data.rows || []);
        } catch (error: unknown) {
            console.error('Error fetching sales report:', error);
            toast.error(getErrorMessage(error));
        } finally {
            setLoading(false);
        }
    }, [dateFrom, dateTo, cityFilter]);

    useEffect(() => {
        fetchReport();
    }, [fetchReport]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setCityFilter(city.trim());
        }, 450);
        return () => window.clearTimeout(timer);
    }, [city]);

    const totals = useMemo(() => {
        const total = rows.reduce((acc, row) => {
            acc.totalTestsBooked += row.totalTestsBooked;
            acc.totalTestsDone += row.totalTestsDone;
            acc.testsBounced += row.testsBounced;
            acc.revenueCollected += row.revenueCollected;
            acc.totalPatients += row.totalPatients;
            acc.repeatPatients += row.repeatPatients;
            acc.newPatients += row.newPatients;
            return acc;
        }, {
            totalTestsBooked: 0,
            totalTestsDone: 0,
            testsBounced: 0,
            revenueCollected: 0,
            totalPatients: 0,
            repeatPatients: 0,
            newPatients: 0,
        });

        return {
            ...total,
            averageOrderValue: rows.length > 0
                ? rows.reduce((sum, row) => sum + row.averageOrderValue, 0) / rows.length
                : 0,
        };
    }, [rows]);

    const handleExport = () => {
        exportCsv('sales-report', { dateFrom, dateTo, city: cityFilter });
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <h1 className="flex items-center gap-3 text-3xl font-semibold text-gray-900">
                        <BarChart3 className="text-[#4b2192]" size={32} />
                        Sales Report
                    </h1>
                    <p className="mt-1 text-gray-600">Daily sales performance, patient mix, revenue, and fulfilment.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={handleExport}
                        disabled={exporting || loading}
                        className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm transition-colors hover:bg-gray-50 disabled:opacity-50"
                    >
                        {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                        Export CSV
                    </button>
                    <button
                        onClick={fetchReport}
                        disabled={loading}
                        className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm transition-colors hover:bg-gray-50 disabled:opacity-50"
                    >
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                        Refresh
                    </button>
                </div>
            </div>

            <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                <div className="grid gap-4 md:grid-cols-3">
                    <label className="space-y-2">
                        <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
                            <Calendar size={16} />
                            From
                        </span>
                        <input
                            type="date"
                            value={dateFrom}
                            onChange={(event) => setDateFrom(event.target.value)}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#4b2192]"
                        />
                    </label>
                    <label className="space-y-2">
                        <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
                            <Calendar size={16} />
                            To
                        </span>
                        <input
                            type="date"
                            value={dateTo}
                            onChange={(event) => setDateTo(event.target.value)}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#4b2192]"
                        />
                    </label>
                    <label className="space-y-2">
                        <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
                            <MapPin size={16} />
                            City
                        </span>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                            <input
                                type="text"
                                value={city}
                                onChange={(event) => setCity(event.target.value)}
                                placeholder="All cities"
                                className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#4b2192]"
                            />
                        </div>
                    </label>
                </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                    <p className="text-sm text-gray-500">Tests Booked</p>
                    <p className="mt-2 text-2xl font-semibold text-gray-900">{totals.totalTestsBooked}</p>
                </div>
                <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                    <p className="text-sm text-gray-500">Tests Done</p>
                    <p className="mt-2 text-2xl font-semibold text-green-700">{totals.totalTestsDone}</p>
                </div>
                <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                    <p className="text-sm text-gray-500">Revenue Collected</p>
                    <p className="mt-2 text-2xl font-semibold text-gray-900">{formatCurrency(totals.revenueCollected)}</p>
                </div>
                <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                    <p className="text-sm text-gray-500">Patients</p>
                    <p className="mt-2 text-2xl font-semibold text-gray-900">{totals.totalPatients}</p>
                </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                    <p className="text-sm font-medium text-gray-700">{rows.length} rows</p>
                    <p className="text-xs text-gray-500">Grouped by booking date</p>
                </div>

                <div className="overflow-x-auto">
                    <table className="min-w-[980px] w-full divide-y divide-gray-100 text-sm">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 py-3 text-left font-semibold text-gray-700">date</th>
                                <th className="px-4 py-3 text-right font-semibold text-gray-700">total tests booked</th>
                                <th className="px-4 py-3 text-right font-semibold text-gray-700">total tests done</th>
                                <th className="px-4 py-3 text-right font-semibold text-gray-700">tests bounced</th>
                                <th className="px-4 py-3 text-right font-semibold text-gray-700">revenue collected</th>
                                <th className="px-4 py-3 text-right font-semibold text-gray-700">average order value</th>
                                <th className="px-4 py-3 text-right font-semibold text-gray-700">total patients</th>
                                <th className="px-4 py-3 text-right font-semibold text-gray-700">repeat patients</th>
                                <th className="px-4 py-3 text-right font-semibold text-gray-700">new patients</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                            {loading ? (
                                <tr>
                                    <td colSpan={9} className="px-4 py-14 text-center text-gray-500">
                                        <div className="inline-flex items-center gap-2">
                                            <Loader2 className="h-5 w-5 animate-spin" />
                                            Loading sales report...
                                        </div>
                                    </td>
                                </tr>
                            ) : rows.length === 0 ? (
                                <tr>
                                    <td colSpan={9} className="px-4 py-14 text-center text-gray-500">
                                        No sales data found for the selected filters.
                                    </td>
                                </tr>
                            ) : (
                                rows.map((row) => (
                                    <tr key={row.date} className="hover:bg-gray-50">
                                        <td className="whitespace-nowrap px-4 py-3 text-gray-900">{formatDate(row.date)}</td>
                                        <td className="px-4 py-3 text-right text-gray-700">{row.totalTestsBooked}</td>
                                        <td className="px-4 py-3 text-right text-gray-700">{row.totalTestsDone}</td>
                                        <td className="px-4 py-3 text-right text-gray-700">{row.testsBounced}</td>
                                        <td className="px-4 py-3 text-right font-medium text-gray-900">{formatCurrency(row.revenueCollected)}</td>
                                        <td className="px-4 py-3 text-right text-gray-700">{formatCurrency(row.averageOrderValue)}</td>
                                        <td className="px-4 py-3 text-right text-gray-700">{row.totalPatients}</td>
                                        <td className="px-4 py-3 text-right text-gray-700">{row.repeatPatients}</td>
                                        <td className="px-4 py-3 text-right text-gray-700">{row.newPatients}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
