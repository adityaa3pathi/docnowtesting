'use client';

import { useState } from 'react';
import { Search, Eye, AlertCircle } from 'lucide-react';

interface Order {
    id: string;
    orderId: string;
    customer: string;
    paymentStatus: 'Paid' | 'Pending' | 'Failed';
    bookingStatus: 'Confirmed' | 'Pending' | 'Completed' | 'Cancelled';
    amount: number;
    createdAt: string;
    tests: string[];
}

const mockOrders: Order[] = [
    { id: '1', orderId: 'ORD-2024-001', customer: 'Rajesh Kumar', paymentStatus: 'Paid', bookingStatus: 'Confirmed', amount: 3200, createdAt: '2024-02-14 10:30 AM', tests: ['CBC Test', 'Liver Function Test'] },
    { id: '2', orderId: 'ORD-2024-002', customer: 'Priya Sharma', paymentStatus: 'Pending', bookingStatus: 'Pending', amount: 1850, createdAt: '2024-02-14 09:15 AM', tests: ['Thyroid Profile'] },
    { id: '3', orderId: 'ORD-2024-003', customer: 'Amit Patel', paymentStatus: 'Paid', bookingStatus: 'Completed', amount: 4500, createdAt: '2024-02-13 03:45 PM', tests: ['Full Body Checkup Package'] },
    { id: '4', orderId: 'ORD-2024-004', customer: 'Sneha Reddy', paymentStatus: 'Failed', bookingStatus: 'Cancelled', amount: 2100, createdAt: '2024-02-13 11:20 AM', tests: ['Lipid Profile', 'HbA1c Test'] },
    { id: '5', orderId: 'ORD-2024-005', customer: 'Vikram Singh', paymentStatus: 'Paid', bookingStatus: 'Confirmed', amount: 899, createdAt: '2024-02-12 02:30 PM', tests: ['Diabetes Screening Package'] },
    { id: '6', orderId: 'ORD-2024-006', customer: 'Meera Joshi', paymentStatus: 'Paid', bookingStatus: 'Completed', amount: 1350, createdAt: '2024-02-11 10:00 AM', tests: ['Kidney Function Test', 'CBC Test'] },
];

export default function OrdersPage() {
    const [searchTerm, setSearchTerm] = useState('');
    const [paymentFilter, setPaymentFilter] = useState('all');
    const [bookingFilter, setBookingFilter] = useState('all');

    const filtered = mockOrders.filter((order) => {
        const matchSearch = order.orderId.toLowerCase().includes(searchTerm.toLowerCase()) || order.customer.toLowerCase().includes(searchTerm.toLowerCase());
        const matchPayment = paymentFilter === 'all' || order.paymentStatus === paymentFilter;
        const matchBooking = bookingFilter === 'all' || order.bookingStatus === bookingFilter;
        return matchSearch && matchPayment && matchBooking;
    });

    const paidOrders = mockOrders.filter(o => o.paymentStatus === 'Paid');
    const pendingOrders = mockOrders.filter(o => o.paymentStatus === 'Pending');
    const totalRevenue = paidOrders.reduce((s, o) => s + o.amount, 0);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <div className="flex items-center gap-2">
                    <h1 className="text-3xl font-semibold text-gray-900">Orders</h1>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">Read-only</span>
                </div>
                <p className="text-gray-600 mt-1">View customer orders and booking status</p>
            </div>

            {/* Read-Only Notice */}
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-orange-600 flex-shrink-0 mt-0.5" />
                    <div>
                        <h3 className="font-semibold text-orange-900">Manager View Only</h3>
                        <p className="text-sm text-orange-800 mt-1">
                            You can view orders placed through your payment links, but cannot modify bookings or process refunds. Contact admin for order management.
                        </p>
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                            type="search"
                            placeholder="Search orders or customers..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2"
                        />
                    </div>
                    <select
                        value={paymentFilter}
                        onChange={(e) => setPaymentFilter(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    >
                        <option value="all">All Payment Status</option>
                        <option value="Paid">Paid</option>
                        <option value="Pending">Pending</option>
                        <option value="Failed">Failed</option>
                    </select>
                    <select
                        value={bookingFilter}
                        onChange={(e) => setBookingFilter(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    >
                        <option value="all">All Booking Status</option>
                        <option value="Confirmed">Confirmed</option>
                        <option value="Pending">Pending</option>
                        <option value="Completed">Completed</option>
                        <option value="Cancelled">Cancelled</option>
                    </select>
                </div>
            </div>

            {/* Orders Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200">
                <div className="px-6 py-4 border-b border-gray-200">
                    <h2 className="font-semibold text-gray-900">All Orders ({filtered.length})</h2>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-200 text-left">
                                <th className="px-6 py-3 font-medium text-gray-500">Order ID</th>
                                <th className="px-6 py-3 font-medium text-gray-500">Customer</th>
                                <th className="px-6 py-3 font-medium text-gray-500">Tests/Packages</th>
                                <th className="px-6 py-3 font-medium text-gray-500">Payment</th>
                                <th className="px-6 py-3 font-medium text-gray-500">Booking</th>
                                <th className="px-6 py-3 font-medium text-gray-500">Amount</th>
                                <th className="px-6 py-3 font-medium text-gray-500">Created</th>
                                <th className="px-6 py-3 font-medium text-gray-500 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((order, index) => (
                                <tr key={order.id} className={`border-b border-gray-100 ${index % 2 === 0 ? 'bg-gray-50/50' : ''}`}>
                                    <td className="px-6 py-3 font-medium font-mono text-sm">{order.orderId}</td>
                                    <td className="px-6 py-3 font-medium">{order.customer}</td>
                                    <td className="px-6 py-3">
                                        <div className="max-w-xs">
                                            <p className="text-sm truncate">{order.tests.join(', ')}</p>
                                            {order.tests.length > 1 && (
                                                <p className="text-xs text-gray-500 mt-0.5">{order.tests.length} items</p>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-6 py-3">
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${order.paymentStatus === 'Paid' ? 'bg-green-100 text-green-800'
                                                : order.paymentStatus === 'Pending' ? 'bg-orange-100 text-orange-800'
                                                    : 'bg-red-100 text-red-800'
                                            }`}>
                                            {order.paymentStatus}
                                        </span>
                                    </td>
                                    <td className="px-6 py-3">
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${order.bookingStatus === 'Confirmed' ? 'bg-blue-100 text-blue-800'
                                                : order.bookingStatus === 'Completed' ? 'bg-green-100 text-green-800'
                                                    : order.bookingStatus === 'Pending' ? 'bg-orange-100 text-orange-800'
                                                        : 'bg-gray-100 text-gray-600'
                                            }`}>
                                            {order.bookingStatus}
                                        </span>
                                    </td>
                                    <td className="px-6 py-3 font-semibold">₹{order.amount.toLocaleString()}</td>
                                    <td className="px-6 py-3 text-gray-500 text-sm">{order.createdAt}</td>
                                    <td className="px-6 py-3">
                                        <div className="flex justify-end">
                                            <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                                                <Eye className="h-4 w-4 text-gray-600" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {filtered.length === 0 && (
                    <div className="text-center py-12">
                        <p className="text-gray-500">No orders found</p>
                    </div>
                )}
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
                    <p className="text-sm text-gray-600">Total Orders</p>
                    <p className="text-2xl font-semibold text-gray-900 mt-1">{mockOrders.length}</p>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
                    <p className="text-sm text-gray-600">Paid Orders</p>
                    <p className="text-2xl font-semibold text-green-600 mt-1">{paidOrders.length}</p>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
                    <p className="text-sm text-gray-600">Pending Orders</p>
                    <p className="text-2xl font-semibold text-orange-600 mt-1">{pendingOrders.length}</p>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
                    <p className="text-sm text-gray-600">Total Revenue</p>
                    <p className="text-2xl font-semibold mt-1" style={{ color: '#4b2192' }}>₹{totalRevenue.toLocaleString()}</p>
                </div>
            </div>
        </div>
    );
}
