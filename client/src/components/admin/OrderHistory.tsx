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
import { Order } from '@/types/admin';
import { formatDate, formatDateTime, getStatusColor, getPaymentStatusColor } from '@/utils/formatters';

interface OrderHistoryProps {
    orders: Order[];
    expandedOrders: Set<string>;
    onToggleExpand: (orderId: string) => void;
}

export function OrderHistory({ orders, expandedOrders, onToggleExpand }: OrderHistoryProps) {
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

                                        {/* Test Items Table */}
                                        <div>
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
                                                                    <div className="text-xs text-gray-400 font-mono">{item.testCode}</div>
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
                                                        <a
                                                            key={report.id}
                                                            href={report.reportUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-sm font-medium transition-colors"
                                                        >
                                                            <FileText size={16} />
                                                            Report {idx + 1}
                                                            <ExternalLink size={14} />
                                                        </a>
                                                    ))}
                                                </div>
                                                <p className="text-xs text-gray-400 mt-1">
                                                    Generated on {formatDateTime(order.reports[0].generatedAt)}
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
