import {
    ShoppingCart,
    ChevronDown,
    ChevronRight,
    FileText,
    ExternalLink,
    TestTube,
    UserCheck,
    Calendar,
    MapPin,
    CreditCard,
} from 'lucide-react';
import { downloadAuthenticatedFile, getApiUrl } from '@/lib/api';
import { Order } from '@/types/admin';
import { formatDate, formatDateTime, getStatusColor, getPaymentStatusColor } from '@/utils/formatters';
import { useState } from 'react';
import toast from 'react-hot-toast';

interface OrderHistoryProps {
    orders: Order[];
    expandedOrders: Set<string>;
    onToggleExpand: (orderId: string) => void;
}

export function OrderHistory({ orders, expandedOrders, onToggleExpand }: OrderHistoryProps) {
    const [downloadingReportId, setDownloadingReportId] = useState<string | null>(null);

    const handleDownloadReport = async (reportId: string) => {
        setDownloadingReportId(reportId);
        try {
            await downloadAuthenticatedFile(getApiUrl(`/reports/${reportId}/download`), `report-${reportId}.pdf`);
        } catch (error: any) {
            console.error('Error downloading report:', error);
            toast.error(error.message || 'Failed to download report');
        } finally {
            setDownloadingReportId(null);
        }
    };

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <ShoppingCart size={20} className="text-orange-600" />
                Order History ({orders.length})
            </h3>
            {orders.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No orders yet</p>
            ) : (
                <div className="space-y-3">
                    {orders.map((order) => {
                        const isExpanded = expandedOrders.has(order.id);
                        return (
                            <div key={order.id} className="border border-gray-100 rounded-xl overflow-hidden">
                                {/* Order Summary Row */}
                                <button
                                    onClick={() => onToggleExpand(order.id)}
                                    className="w-full flex items-center gap-4 px-5 py-4 hover:bg-gray-50/80 transition-colors text-left"
                                >
                                    <div className="text-gray-400">
                                        {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                    </div>
                                    <div className="flex-1 grid grid-cols-2 md:grid-cols-5 gap-3 items-center">
                                        <div>
                                            <p className="text-xs text-gray-400 uppercase font-medium">Booking ID</p>
                                            <p className="font-mono text-sm font-medium text-gray-900">
                                                {order.partnerBookingId || order.id.slice(0, 8)}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-gray-400 uppercase font-medium">Date</p>
                                            <p className="text-sm text-gray-700">{formatDate(order.createdAt)}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-gray-400 uppercase font-medium">Amount</p>
                                            <p className="text-sm font-semibold text-gray-900">₹{order.totalAmount.toLocaleString('en-IN')}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-gray-400 uppercase font-medium">Payment</p>
                                            <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${getPaymentStatusColor(order.paymentStatus)}`}>
                                                {order.paymentStatus}
                                            </span>
                                        </div>
                                        <div>
                                            <p className="text-xs text-gray-400 uppercase font-medium">Status</p>
                                            <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${getStatusColor(order.status)}`}>
                                                {order.status}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {order.reports.length > 0 && (
                                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded-full">
                                                <FileText size={12} />
                                                {order.reports.length} Report{order.reports.length > 1 ? 's' : ''}
                                            </span>
                                        )}
                                        <span className="text-xs text-gray-400">
                                            {order.items.length} test{order.items.length !== 1 ? 's' : ''}
                                        </span>
                                    </div>
                                </button>

                                {/* Expanded Details */}
                                {isExpanded && (
                                    <div className="border-t border-gray-100 bg-gray-50/50 px-5 py-4 space-y-4">
                                        {/* Price Breakdown */}
                                        {(order.discountAmount > 0 || order.walletAmount > 0) && (
                                            <div className="flex flex-wrap gap-4 text-sm">
                                                <div className="flex items-center gap-2">
                                                    <CreditCard size={14} className="text-gray-400" />
                                                    <span className="text-gray-500">Total:</span>
                                                    <span className="font-medium">₹{order.totalAmount.toLocaleString('en-IN')}</span>
                                                </div>
                                                {order.discountAmount > 0 && (
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-green-600">-₹{order.discountAmount.toLocaleString('en-IN')} promo</span>
                                                    </div>
                                                )}
                                                {order.walletAmount > 0 && (
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-blue-600">-₹{order.walletAmount.toLocaleString('en-IN')} wallet</span>
                                                    </div>
                                                )}
                                                <div className="flex items-center gap-1">
                                                    <span className="text-gray-500">Paid:</span>
                                                    <span className="font-semibold text-gray-900">₹{order.finalAmount.toLocaleString('en-IN')}</span>
                                                </div>
                                            </div>
                                        )}

                                        {/* Billing Name */}
                                        {order.billingName && (
                                            <div className="flex items-center gap-2 text-sm">
                                                <span className="text-gray-500">Invoice to:</span>
                                                <span className="font-medium text-gray-800">{order.billingName}</span>
                                            </div>
                                        )}

                                        {/* Slot & Address */}
                                        <div className="flex flex-wrap gap-6 text-sm">
                                            {order.slotDate && order.slotTime && (
                                                <div className="flex items-center gap-2 text-gray-600">
                                                    <Calendar size={14} className="text-gray-400" />
                                                    <span>Slot: {order.slotDate} at {order.slotTime}</span>
                                                </div>
                                            )}
                                            {order.address && (
                                                <div className="flex items-center gap-2 text-gray-600">
                                                    <MapPin size={14} className="text-gray-400" />
                                                    <span>{order.address.line1}, {order.address.city} - {order.address.pincode}</span>
                                                </div>
                                            )}
                                        </div>

                                        {/* Webhook Tracking Block (UAT visibility) */}
                                        {(order.phleboName || order.partnerStatus || order.partnerError) && (
                                            <div className="bg-blue-50/50 p-4 rounded-lg border border-blue-100 mt-2 space-y-3">
                                                <h4 className="text-sm font-semibold text-blue-900 flex items-center gap-2">
                                                    Webhook Sync Status
                                                </h4>
                                                
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                                    {/* Phlebo assignment from webhook */}
                                                    {order.phleboName && (
                                                        <div className="space-y-1">
                                                            <span className="block text-xs text-blue-500 font-medium">Phlebotomist</span>
                                                            <div className="text-gray-800 font-medium">{order.phleboName}</div>
                                                            <div className="text-gray-600">{order.phleboPhone}</div>
                                                            {order.phleboTrackingUrl && (
                                                                <a href={order.phleboTrackingUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:text-blue-800 underline mt-1 inline-block">
                                                                    Track Phlebo Location
                                                                </a>
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* Partner status processing */}
                                                    {(order.partnerStatus || order.partnerError || order.rescheduledToId) && (
                                                        <div className="space-y-1">
                                                            <span className="block text-xs text-blue-500 font-medium">Partner System State</span>
                                                            
                                                            {order.partnerStatus && (
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-gray-600">Raw DB Status:</span>
                                                                    <span className="font-mono bg-white px-2 py-0.5 rounded border border-gray-200 text-xs">{order.partnerStatus}</span>
                                                                </div>
                                                            )}
                                                            
                                                            {order.rescheduledToId && (
                                                                <div className="text-amber-600 text-xs mt-1">
                                                                    Rescheduled / Resampled to new ID: <span className="font-bold">{order.rescheduledToId}</span>
                                                                </div>
                                                            )}

                                                            {order.partnerError && (
                                                                <div className="text-red-600 text-xs mt-1">
                                                                    <span className="font-semibold">Partner Rejection/Remark:</span> {order.partnerError}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {/* Test Items Table */}
                                        <div className="mt-4">
                                            <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                                                <TestTube size={14} className="text-purple-600" />
                                                Tests & Patients
                                            </h4>
                                            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                                                <table className="w-full text-sm">
                                                    <thead className="bg-gray-50">
                                                        <tr>
                                                            <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Test Name</th>
                                                            <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Patient</th>
                                                            <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Relation</th>
                                                            <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Price</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-gray-100">
                                                        {order.items.map((item) => (
                                                            <tr key={item.id} className="hover:bg-gray-50">
                                                                <td className="px-4 py-3">
                                                                    <div className="font-medium text-gray-900">{item.testName}</div>
                                                                    <div className="text-xs text-gray-400 font-mono mb-1">{item.testCode}</div>
                                                                    {item.status && (
                                                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-700">
                                                                            {item.status}
                                                                        </span>
                                                                    )}
                                                                </td>
                                                                <td className="px-4 py-3">
                                                                    <div className="flex items-center gap-2">
                                                                        <UserCheck size={14} className="text-teal-500" />
                                                                        <div>
                                                                            <span className="font-medium text-gray-800">{item.patient.name}</span>
                                                                            <span className="text-xs text-gray-400 ml-2">
                                                                                {item.patient.age}y, {item.patient.gender}
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                </td>
                                                                <td className="px-4 py-3">
                                                                    <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-teal-50 text-teal-700">
                                                                        {item.patient.relation}
                                                                    </span>
                                                                </td>
                                                                <td className="px-4 py-3 font-medium text-gray-900">
                                                                    ₹{item.price.toLocaleString('en-IN')}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>

                                        {/* Reports */}
                                        {order.reports.length > 0 && (
                                            <div>
                                                <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                                                    <FileText size={14} className="text-blue-600" />
                                                    Reports
                                                </h4>
                                                <div className="flex flex-wrap gap-2">
                                                    {order.reports.map((report, idx) => (
                                                        <button
                                                            type="button"
                                                            key={report.id}
                                                            onClick={() => report.id && handleDownloadReport(report.id)}
                                                            disabled={!report.id || downloadingReportId === report.id}
                                                            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                                                report.fetchStatus === 'STORED'
                                                                    ? 'bg-blue-50 hover:bg-blue-100 text-blue-700'
                                                                    : report.fetchStatus === 'FAILED'
                                                                    ? 'bg-red-50 hover:bg-red-100 text-red-700'
                                                                    : 'bg-amber-50 hover:bg-amber-100 text-amber-700'
                                                            }`}
                                                        >
                                                            <FileText size={16} />
                                                            {report.isFullReport ? 'Full' : 'Partial'} Report {idx + 1}
                                                            {report.fetchStatus === 'STORED' && downloadingReportId !== report.id && <ExternalLink size={14} />}
                                                            {downloadingReportId === report.id && (
                                                                <span className="text-xs opacity-70">Downloading...</span>
                                                            )}
                                                            {report.fetchStatus === 'PENDING' && (
                                                                <span className="text-xs opacity-70">⏳</span>
                                                            )}
                                                            {report.fetchStatus === 'FAILED' && (
                                                                <span className="text-xs opacity-70">⚠️</span>
                                                            )}
                                                        </button>
                                                    ))}
                                                </div>
                                                <p className="text-xs text-gray-400 mt-1">
                                                    {order.reports[0].verifiedAt
                                                        ? `Verified ${formatDateTime(order.reports[0].verifiedAt)}`
                                                        : `Generated ${formatDateTime(order.reports[0].generatedAt)}`
                                                    }
                                                </p>
                                            </div>
                                        )}

                                        {order.items.length === 0 && (
                                            <p className="text-sm text-gray-400 italic">No test items recorded for this order</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
