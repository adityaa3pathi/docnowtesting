'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Calendar,
    ChevronLeft,
    ChevronRight,
    Download,
    Eye,
    FileText,
    Loader2,
    RefreshCw,
    Search,
    XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { CancelDialog } from '@/components/profile/bookings/CancelDialog';
import { RescheduleDialog } from '@/components/profile/bookings/RescheduleDialog';
import type { BookingHeader } from '@/components/profile/bookings/types';
import { Button } from '@/components/ui';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import api, { downloadAuthenticatedFile, getApiUrl } from '@/lib/api';

interface Order {
    id: string;
    partnerBookingId: string | null;
    date: string;
    createdAt: string;
    slotDate: string;
    slotTime: string;
    amount: number;
    status: string;
    paymentStatus: string;
    user: {
        id: string;
        name: string | null;
        mobile: string;
        email: string | null;
    };
    address: {
        id: string;
        line1: string;
        city: string;
        pincode: string;
    } | null;
    managerOrder: {
        id: string;
        status: string;
        managerId: string;
    } | null;
    patient: {
        name: string;
        gender: string;
        age: number;
    } | null;
    testNames: string[];
    reportCount: number;
    latestReportId: string | null;
    latestReportStatus: string | null;
    canCancel: boolean;
    canReschedule: boolean;
}

interface Pagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

interface ReportItem {
    id: string;
    isFullReport: boolean;
    fetchStatus: string;
    verifiedAt: string | null;
    fileSize: number | null;
    generatedAt: string;
    vendorCustomerId: string | null;
}

const STATUS_FILTERS = ['All', 'Order Booked', 'Report Generated', 'Cancelled', 'Rescheduled'];

function formatDate(dateStr?: string | null) {
    if (!dateStr) return 'NA';
    return new Date(dateStr).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}

function getStatusColor(status: string) {
    const value = status.toLowerCase();
    if (value.includes('report') || value.includes('complete')) return 'bg-green-100 text-green-700';
    if (value.includes('cancel')) return 'bg-red-100 text-red-700';
    if (value.includes('resched')) return 'bg-amber-100 text-amber-700';
    if (value.includes('booked') || value.includes('pending')) return 'bg-blue-100 text-blue-700';
    return 'bg-gray-100 text-gray-700';
}

function toBookingHeader(order: Order): BookingHeader {
    return {
        id: order.id,
        partnerBookingId: order.partnerBookingId,
        status: order.status,
        paymentStatus: order.paymentStatus,
        slotDate: order.slotDate,
        slotTime: order.slotTime,
        totalAmount: order.amount,
        createdAt: order.createdAt,
        addressId: order.address?.id,
        items: order.testNames,
        reports: [],
    };
}

export default function OrdersPage() {
    const [orders, setOrders] = useState<Order[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('All');
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [rescheduleOrder, setRescheduleOrder] = useState<Order | null>(null);
    const [cancelOrder, setCancelOrder] = useState<Order | null>(null);
    const [reportModalOrder, setReportModalOrder] = useState<Order | null>(null);
    const [reports, setReports] = useState<ReportItem[]>([]);
    const [reportsLoading, setReportsLoading] = useState(false);
    const [downloadLoadingId, setDownloadLoadingId] = useState<string | null>(null);

    const fetchOrders = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/manager/bookings', {
                params: {
                    page: pagination.page,
                    limit: pagination.limit,
                    status: statusFilter,
                    search: searchTerm || undefined,
                }
            });

            setOrders(res.data.orders);
            setPagination(res.data.pagination);
        } catch (error) {
            console.error('Error fetching manager bookings:', error);
            toast.error('Failed to load bookings');
        } finally {
            setLoading(false);
        }
    }, [pagination.page, pagination.limit, searchTerm, statusFilter]);

    useEffect(() => {
        fetchOrders();
    }, [fetchOrders]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setPagination((prev) => ({ ...prev, page: 1 }));
        }, 400);

        return () => window.clearTimeout(timer);
    }, [searchTerm, statusFilter]);

    const stats = useMemo(() => ({
        total: pagination.total,
        reportsReady: orders.filter((order) => order.reportCount > 0).length,
        cancellable: orders.filter((order) => order.canCancel).length,
        reschedulable: orders.filter((order) => order.canReschedule).length,
    }), [orders, pagination.total]);

    const fetchReports = useCallback(async (bookingId: string) => {
        setReportsLoading(true);
        try {
            const res = await api.get(`/manager/bookings/${bookingId}/reports`);
            setReports(res.data.reports || []);
        } catch (error) {
            console.error('Error fetching reports:', error);
            toast.error('Failed to load reports');
        } finally {
            setReportsLoading(false);
        }
    }, []);

    const handleDownloadReport = async (reportId: string) => {
        setDownloadLoadingId(reportId);
        try {
            await downloadAuthenticatedFile(getApiUrl(`/reports/${reportId}/download`), `report-${reportId}.pdf`);
        } catch (error: any) {
            toast.error(error.message || 'Failed to download report');
        } finally {
            setDownloadLoadingId(null);
        }
    };

    const handleOpenReports = async (order: Order) => {
        if (order.reportCount === 0) return;

        if (order.reportCount === 1 && order.latestReportId) {
            await handleDownloadReport(order.latestReportId);
            return;
        }

        setReportModalOrder(order);
        await fetchReports(order.id);
    };

    const rescheduleBookingHeader = rescheduleOrder ? toBookingHeader(rescheduleOrder) : null;

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <h1 className="text-3xl font-semibold text-gray-900">Global Orders</h1>
                    <p className="mt-1 text-sm text-gray-600">View bookings across the platform and take action from one place.</p>
                </div>
                <button
                    onClick={fetchOrders}
                    className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                >
                    <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                    Refresh
                </button>
            </div>

            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                {[
                    { label: 'Total Bookings', value: stats.total, tone: 'text-gray-900' },
                    { label: 'Reports Ready', value: stats.reportsReady, tone: 'text-green-700' },
                    { label: 'Can Cancel', value: stats.cancellable, tone: 'text-red-700' },
                    { label: 'Can Reschedule', value: stats.reschedulable, tone: 'text-blue-700' },
                ].map((item) => (
                    <div key={item.label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                        <p className="text-xs uppercase tracking-wide text-gray-500">{item.label}</p>
                        <p className={`mt-2 text-2xl font-bold ${item.tone}`}>{item.value}</p>
                    </div>
                ))}
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <input
                            type="search"
                            value={searchTerm}
                            onChange={(event) => setSearchTerm(event.target.value)}
                            placeholder="Search by booking ID, partner ID, customer, patient, or test name"
                            className="w-full rounded-lg border border-gray-300 py-2.5 pl-10 pr-4 text-sm focus:border-[#4b2192] focus:outline-none focus:ring-2 focus:ring-[#4b2192]/10"
                        />
                    </div>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                        {STATUS_FILTERS.map((status) => (
                            <button
                                key={status}
                                onClick={() => setStatusFilter(status)}
                                className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm transition-colors ${statusFilter === status
                                    ? 'bg-[#4b2192] text-white'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                            >
                                {status}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                {loading ? (
                    <div className="flex h-64 items-center justify-center">
                        <Loader2 className="h-8 w-8 animate-spin text-[#4b2192]" />
                    </div>
                ) : orders.length === 0 ? (
                    <div className="flex h-64 items-center justify-center text-sm text-gray-500">
                        No bookings found.
                    </div>
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[1200px]">
                                <thead className="border-b border-gray-100 bg-gray-50">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Booking</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Customer / Patient</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Tests</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Slot</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Payment</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Reports</th>
                                        <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {orders.map((order) => (
                                        <tr key={order.id} className="hover:bg-gray-50">
                                            <td className="px-6 py-4 align-top">
                                                <p className="font-mono text-sm font-semibold text-gray-900">{order.partnerBookingId || order.id.slice(0, 8)}</p>
                                                <p className="mt-1 text-xs text-gray-500">Local: {order.id.slice(0, 8)}...</p>
                                                <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getStatusColor(order.status)}`}>
                                                    {order.status}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 align-top">
                                                <p className="text-sm font-semibold text-gray-900">{order.user.name || 'Unnamed User'}</p>
                                                <p className="text-xs text-gray-500">{order.user.mobile}</p>
                                                <p className="mt-2 text-xs text-gray-700">
                                                    Patient: {order.patient?.name || 'NA'}
                                                    {order.patient ? ` • ${order.patient.gender}, ${order.patient.age}` : ''}
                                                </p>
                                            </td>
                                            <td className="px-6 py-4 align-top">
                                                <div className="max-w-xs space-y-1">
                                                    {order.testNames.slice(0, 3).map((name) => (
                                                        <p key={`${order.id}-${name}`} className="text-sm text-gray-700">{name}</p>
                                                    ))}
                                                    {order.testNames.length > 3 && (
                                                        <p className="text-xs text-blue-600">+{order.testNames.length - 3} more</p>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 align-top text-sm text-gray-700">
                                                <div className="flex items-center gap-2">
                                                    <Calendar size={14} className="text-gray-400" />
                                                    <span>{formatDate(order.slotDate)}</span>
                                                </div>
                                                <p className="mt-1 text-xs text-gray-500">{order.slotTime || 'NA'}</p>
                                                <p className="mt-2 text-xs text-gray-500">Created {formatDate(order.createdAt)}</p>
                                            </td>
                                            <td className="px-6 py-4 align-top">
                                                <p className="text-sm font-semibold text-gray-900">₹{order.amount.toLocaleString('en-IN')}</p>
                                                <p className="mt-1 text-xs text-gray-500">{order.paymentStatus}</p>
                                                {order.managerOrder && (
                                                    <p className="mt-1 text-xs text-purple-700">Manager order: {order.managerOrder.status}</p>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 align-top">
                                                {order.reportCount > 0 ? (
                                                    <button
                                                        onClick={() => handleOpenReports(order)}
                                                        className="inline-flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs font-medium text-green-700 transition-colors hover:bg-green-100"
                                                    >
                                                        <FileText size={14} />
                                                        {order.reportCount === 1 ? 'Download report' : `${order.reportCount} reports`}
                                                    </button>
                                                ) : (
                                                    <span className="text-xs text-gray-400">No reports yet</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 align-top">
                                                <div className="flex justify-end gap-2">
                                                    <button
                                                        onClick={() => setSelectedOrder(order)}
                                                        className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-[#4b2192]"
                                                        title="View details"
                                                    >
                                                        <Eye size={18} />
                                                    </button>
                                                    <button
                                                        onClick={() => setRescheduleOrder(order)}
                                                        disabled={!order.canReschedule}
                                                        className="rounded-lg p-2 text-blue-600 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-gray-300"
                                                        title="Reschedule"
                                                    >
                                                        <Calendar size={18} />
                                                    </button>
                                                    <button
                                                        onClick={() => setCancelOrder(order)}
                                                        disabled={!order.canCancel}
                                                        className="rounded-lg p-2 text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:text-gray-300"
                                                        title="Cancel"
                                                    >
                                                        <XCircle size={18} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
                            <p className="text-sm text-gray-500">
                                Page {pagination.page} of {Math.max(pagination.totalPages, 1)}
                            </p>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setPagination((prev) => ({ ...prev, page: Math.max(prev.page - 1, 1) }))}
                                    disabled={pagination.page <= 1}
                                    className="rounded-lg border border-gray-200 bg-white p-2 text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <ChevronLeft size={18} />
                                </button>
                                <button
                                    onClick={() => setPagination((prev) => ({ ...prev, page: Math.min(prev.page + 1, Math.max(prev.totalPages, 1)) }))}
                                    disabled={pagination.page >= pagination.totalPages}
                                    className="rounded-lg border border-gray-200 bg-white p-2 text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <ChevronRight size={18} />
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>

            <Dialog open={Boolean(selectedOrder)} onOpenChange={(open) => !open && setSelectedOrder(null)}>
                <DialogContent className="sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Booking Details</DialogTitle>
                    </DialogHeader>
                    {selectedOrder && (
                        <div className="space-y-5 text-sm">
                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                                    <p className="text-xs uppercase tracking-wide text-gray-500">Booking</p>
                                    <p className="mt-2 font-medium text-gray-900">{selectedOrder.partnerBookingId || selectedOrder.id}</p>
                                    <p className="mt-1 text-gray-500">Status: {selectedOrder.status}</p>
                                    <p className="text-gray-500">Payment: {selectedOrder.paymentStatus}</p>
                                </div>
                                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                                    <p className="text-xs uppercase tracking-wide text-gray-500">Slot</p>
                                    <p className="mt-2 font-medium text-gray-900">{formatDate(selectedOrder.slotDate)}</p>
                                    <p className="mt-1 text-gray-500">{selectedOrder.slotTime}</p>
                                    <p className="text-gray-500">Amount: ₹{selectedOrder.amount.toLocaleString('en-IN')}</p>
                                </div>
                            </div>
                            <div className="grid gap-4 md:grid-cols-2">
                                <div>
                                    <p className="text-xs uppercase tracking-wide text-gray-500">Customer</p>
                                    <p className="mt-2 font-medium text-gray-900">{selectedOrder.user.name || 'Unnamed User'}</p>
                                    <p className="text-gray-500">{selectedOrder.user.mobile}</p>
                                    <p className="text-gray-500">{selectedOrder.user.email || 'No email'}</p>
                                </div>
                                <div>
                                    <p className="text-xs uppercase tracking-wide text-gray-500">Patient</p>
                                    <p className="mt-2 font-medium text-gray-900">{selectedOrder.patient?.name || 'NA'}</p>
                                    <p className="text-gray-500">
                                        {selectedOrder.patient ? `${selectedOrder.patient.gender}, ${selectedOrder.patient.age}` : 'No patient summary'}
                                    </p>
                                </div>
                            </div>
                            <div>
                                <p className="text-xs uppercase tracking-wide text-gray-500">Tests / Packages</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {selectedOrder.testNames.map((name) => (
                                        <span key={`${selectedOrder.id}-${name}`} className="rounded-full bg-purple-50 px-3 py-1 text-xs text-purple-700">
                                            {name}
                                        </span>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <p className="text-xs uppercase tracking-wide text-gray-500">Address</p>
                                <p className="mt-2 text-gray-700">
                                    {selectedOrder.address
                                        ? `${selectedOrder.address.line1}, ${selectedOrder.address.city} - ${selectedOrder.address.pincode}`
                                        : 'No saved address on this booking'}
                                </p>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            <Dialog open={Boolean(reportModalOrder)} onOpenChange={(open) => !open && setReportModalOrder(null)}>
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>
                            {reportModalOrder ? `Reports for ${reportModalOrder.partnerBookingId || reportModalOrder.id.slice(0, 8)}` : 'Booking Reports'}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                        {reportsLoading ? (
                            <div className="flex items-center justify-center py-10 text-gray-500">
                                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                Loading reports...
                            </div>
                        ) : reports.length === 0 ? (
                            <div className="py-10 text-center text-sm text-gray-500">No reports available.</div>
                        ) : (
                            reports.map((report) => (
                                <div key={report.id} className="flex items-center justify-between rounded-xl border border-gray-200 p-4">
                                    <div>
                                        <p className="text-sm font-semibold text-gray-900">
                                            {report.isFullReport ? 'Full report' : 'Report'} • {formatDate(report.generatedAt)}
                                        </p>
                                        <p className="mt-1 text-xs text-gray-500">
                                            Status: {report.fetchStatus}
                                            {report.vendorCustomerId ? ` • Customer ${report.vendorCustomerId}` : ''}
                                        </p>
                                    </div>
                                    <Button
                                        onClick={() => handleDownloadReport(report.id)}
                                        disabled={downloadLoadingId === report.id}
                                        className="gap-2"
                                    >
                                        {downloadLoadingId === report.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                                        Download
                                    </Button>
                                </div>
                            ))
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            <RescheduleDialog
                booking={rescheduleBookingHeader}
                open={Boolean(rescheduleOrder)}
                onOpenChange={(open) => !open && setRescheduleOrder(null)}
                onSuccess={() => {
                    setRescheduleOrder(null);
                    fetchOrders();
                }}
                apiPrefix="/manager/bookings"
            />

            <CancelDialog
                bookingId={cancelOrder?.id || null}
                open={Boolean(cancelOrder)}
                onOpenChange={(open) => !open && setCancelOrder(null)}
                onSuccess={() => {
                    setCancelOrder(null);
                    fetchOrders();
                }}
                apiPrefix="/manager/bookings"
            />
        </div>
    );
}
