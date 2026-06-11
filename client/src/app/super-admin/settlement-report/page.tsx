'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, Download, FileSpreadsheet, Loader2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { useExport } from '@/hooks/useExport';
import api from '@/lib/api';

interface SettlementReportRow {
    sno: number;
    bookingDate: string;
    bookingTime: string;
    bookingId: string;
    city: string;
    billingCustomerName: string;
    patientsDetails: string;
    deliveryStatus: string;
    testNames: string;
    orderPrice: string;
    collectionCharges: number;
    totalOrderPrice: number;
    paidAmount: number;
    discount: number;
    promoCode: string;
    healthiansShare: number;
    docnowShare: number;
    collectionChargesPaid: number;
    walletAmount: number;
    paymentMode: string;
}

function getErrorMessage(error: unknown) {
    if (typeof error === 'object' && error !== null && 'response' in error) {
        const response = (error as { response?: { data?: { error?: string } } }).response;
        if (response?.data?.error) return response.data.error;
    }
    if (error instanceof Error) return error.message;
    return 'Failed to load settlement report';
}

function toDateInputValue(date: Date) {
    return date.toISOString().slice(0, 10);
}

function formatCurrency(value: number) {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
    }).format(value);
}

function getStatusBadge(status: string) {
    const normalized = status?.trim().toLowerCase() || '';
    let classes = 'inline-block rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ';

    if (normalized === 'report generated' || normalized === 'completed') {
        classes += 'bg-green-100 text-green-800';
    } else if (normalized === 'sample collected') {
        classes += 'bg-blue-100 text-blue-800';
    } else if (normalized === 'order booked' || normalized === 'pending') {
        classes += 'bg-yellow-100 text-yellow-800';
    } else {
        classes += 'bg-gray-100 text-gray-700';
    }

    return <span className={classes}>{status || '—'}</span>;
}

export default function SettlementReportPage() {
    const today = useMemo(() => new Date(), []);
    const thirtyDaysAgo = useMemo(() => {
        const date = new Date();
        date.setDate(date.getDate() - 29);
        return date;
    }, []);

    const [rows, setRows] = useState<SettlementReportRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [dateFrom, setDateFrom] = useState(toDateInputValue(thirtyDaysAgo));
    const [dateTo, setDateTo] = useState(toDateInputValue(today));

    const { exporting, exportCsv } = useExport();

    const fetchReport = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (dateFrom) params.set('dateFrom', dateFrom);
            if (dateTo) params.set('dateTo', dateTo);

            const res = await api.get(`/admin/settlement-report?${params.toString()}`);
            setRows(res.data.rows || []);
        } catch (error: unknown) {
            console.error('Error fetching settlement report:', error);
            toast.error(getErrorMessage(error));
        } finally {
            setLoading(false);
        }
    }, [dateFrom, dateTo]);

    useEffect(() => {
        fetchReport();
    }, [fetchReport]);

    const totals = useMemo(() => {
        return rows.reduce(
            (acc, row) => {
                acc.totalBookings += 1;
                acc.totalRevenue += row.paidAmount;
                acc.healthiansShare += row.healthiansShare;
                acc.docnowShare += row.docnowShare;
                return acc;
            },
            { totalBookings: 0, totalRevenue: 0, healthiansShare: 0, docnowShare: 0 },
        );
    }, [rows]);

    const handleExport = () => {
        exportCsv('settlement-report', { dateFrom, dateTo });
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <h1 className="flex items-center gap-3 text-3xl font-semibold text-gray-900">
                        <FileSpreadsheet className="text-[#4b2192]" size={32} />
                        Settlement Report
                    </h1>
                    <p className="mt-1 text-gray-600">Per-booking financial breakdown with Healthians and DocNow share.</p>
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
                <div className="grid gap-4 md:grid-cols-2">
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
                </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                    <p className="text-sm text-gray-500">Total Bookings</p>
                    <p className="mt-2 text-2xl font-semibold text-gray-900">{totals.totalBookings}</p>
                </div>
                <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                    <p className="text-sm text-gray-500">Total Revenue</p>
                    <p className="mt-2 text-2xl font-semibold text-gray-900">{formatCurrency(totals.totalRevenue)}</p>
                </div>
                <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                    <p className="text-sm text-gray-500">Healthians Share</p>
                    <p className="mt-2 text-2xl font-semibold text-red-600">{formatCurrency(totals.healthiansShare)}</p>
                </div>
                <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                    <p className="text-sm text-gray-500">DocNow Share</p>
                    <p className="mt-2 text-2xl font-semibold text-green-700">{formatCurrency(totals.docnowShare)}</p>
                </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                    <p className="text-sm font-medium text-gray-700">{rows.length} bookings</p>
                </div>

                <div className="overflow-x-auto">
                    <table className="min-w-[2400px] w-full divide-y divide-gray-100 text-sm">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 py-3 text-left font-semibold text-gray-700">S.No</th>
                                <th className="px-4 py-3 text-left font-semibold text-gray-700">Booking Date</th>
                                <th className="px-4 py-3 text-left font-semibold text-gray-700">Booking Time</th>
                                <th className="px-4 py-3 text-left font-semibold text-gray-700">Booking ID</th>
                                <th className="px-4 py-3 text-left font-semibold text-gray-700">City</th>
                                <th className="px-4 py-3 text-left font-semibold text-gray-700">Billing Name</th>
                                <th className="px-4 py-3 text-left font-semibold text-gray-700">Patients</th>
                                <th className="px-4 py-3 text-left font-semibold text-gray-700">Status</th>
                                <th className="px-4 py-3 text-left font-semibold text-gray-700">Tests/Packages</th>
                                <th className="px-4 py-3 text-left font-semibold text-gray-700">Order Price</th>
                                <th className="px-4 py-3 text-right font-semibold text-gray-700">Coll. Charges</th>
                                <th className="px-4 py-3 text-right font-semibold text-gray-700">Total Price</th>
                                <th className="px-4 py-3 text-right font-semibold text-gray-700">Paid Amount</th>
                                <th className="px-4 py-3 text-right font-semibold text-gray-700">Discount</th>
                                <th className="px-4 py-3 text-left font-semibold text-gray-700">Promo</th>
                                <th className="px-4 py-3 text-right font-semibold text-gray-700">Healthians Share</th>
                                <th className="px-4 py-3 text-right font-semibold text-gray-700">DocNow Share</th>
                                <th className="px-4 py-3 text-right font-semibold text-gray-700">Coll. Charges Paid</th>
                                <th className="px-4 py-3 text-right font-semibold text-gray-700">Wallet</th>
                                <th className="px-4 py-3 text-left font-semibold text-gray-700">Payment Mode</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                            {loading ? (
                                <tr>
                                    <td colSpan={20} className="px-4 py-14 text-center text-gray-500">
                                        <div className="inline-flex items-center gap-2">
                                            <Loader2 className="h-5 w-5 animate-spin" />
                                            Loading settlement report...
                                        </div>
                                    </td>
                                </tr>
                            ) : rows.length === 0 ? (
                                <tr>
                                    <td colSpan={20} className="px-4 py-14 text-center text-gray-500">
                                        No settlement data found for the selected filters.
                                    </td>
                                </tr>
                            ) : (
                                rows.map((row) => (
                                    <tr key={row.bookingId + '-' + row.sno} className="hover:bg-gray-50">
                                        <td className="whitespace-nowrap px-4 py-3 text-gray-700">{row.sno}</td>
                                        <td className="whitespace-nowrap px-4 py-3 text-gray-900">{row.bookingDate}</td>
                                        <td className="whitespace-nowrap px-4 py-3 text-gray-700">{row.bookingTime}</td>
                                        <td className="px-4 py-3 text-gray-700">
                                            <span className="block max-w-[120px] truncate" title={row.bookingId}>{row.bookingId}</span>
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-3 text-gray-700">{row.city}</td>
                                        <td className="whitespace-nowrap px-4 py-3 text-gray-900">{row.billingCustomerName}</td>
                                        <td className="px-4 py-3 text-gray-700">
                                            <span className="block max-w-[200px]">{row.patientsDetails}</span>
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-3">{getStatusBadge(row.deliveryStatus)}</td>
                                        <td className="px-4 py-3 text-gray-700">
                                            <span className="block max-w-[200px]">{row.testNames}</span>
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-3 text-gray-700">{row.orderPrice}</td>
                                        <td className="whitespace-nowrap px-4 py-3 text-right text-gray-700">₹{row.collectionCharges}</td>
                                        <td className="whitespace-nowrap px-4 py-3 text-right text-gray-900">{formatCurrency(row.totalOrderPrice)}</td>
                                        <td className="whitespace-nowrap px-4 py-3 text-right font-bold text-gray-900">{formatCurrency(row.paidAmount)}</td>
                                        <td className="whitespace-nowrap px-4 py-3 text-right text-gray-700">₹{row.discount}</td>
                                        <td className="whitespace-nowrap px-4 py-3 text-gray-700">{row.promoCode || '—'}</td>
                                        <td className="whitespace-nowrap px-4 py-3 text-right text-red-600">{formatCurrency(row.healthiansShare)}</td>
                                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-green-700">{formatCurrency(row.docnowShare)}</td>
                                        <td className="whitespace-nowrap px-4 py-3 text-right text-gray-700">₹{row.collectionChargesPaid}</td>
                                        <td className="whitespace-nowrap px-4 py-3 text-right text-gray-700">₹{row.walletAmount}</td>
                                        <td className="whitespace-nowrap px-4 py-3 text-gray-700">{row.paymentMode}</td>
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
