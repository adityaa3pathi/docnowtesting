'use client';

import { useState, useEffect } from 'react';
import {
    DollarSign,
    Users,
    ShoppingCart,
    FileText,
    Wallet,
    Gift,
    TrendingUp,
    TrendingDown,
    Loader2,
} from 'lucide-react';

// KPI Card Component
function KPICard({
    title,
    subtitle,
    value,
    trend,
    trendUp,
    icon: Icon,
    color,
    bgColor,
}: {
    title: string;
    subtitle: string;
    value: string;
    trend?: string;
    trendUp?: boolean;
    icon: React.ElementType;
    color: string;
    bgColor: string;
}) {
    return (
        <div className="bg-white rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between">
                <div className="flex-1">
                    <p className="text-sm text-gray-600">{title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
                    <p className="text-2xl font-semibold text-gray-900 mt-2">{value}</p>
                    {trend && (
                        <div className="flex items-center gap-1 mt-2">
                            {trendUp ? (
                                <TrendingUp size={16} className="text-green-500" />
                            ) : (
                                <TrendingDown size={16} className="text-red-500" />
                            )}
                            <span
                                className={`text-xs ${trendUp ? 'text-green-600' : 'text-red-600'
                                    }`}
                            >
                                {trend}
                            </span>
                            <span className="text-xs text-gray-500">vs last period</span>
                        </div>
                    )}
                </div>
                <div className={`p-3 rounded-lg ${bgColor}`}>
                    <Icon size={24} className={color} />
                </div>
            </div>
        </div>
    );
}

interface DashboardStats {
    totalRevenue: number;
    totalUsers: number;
    newUsersToday: number;
    totalOrders: number;
    ordersToday: number;
    pendingReports: number;
    totalWalletBalance: number;
    referralPayoutsThisWeek: number;
}

import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';

function DashboardPage() {
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [revenueData, setRevenueData] = useState<{ date: string; revenue: number }[]>([]);
    const [highValueOrders, setHighValueOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const token = localStorage.getItem('docnow_auth_token');
                if (!token) return;

                const headers = { Authorization: `Bearer ${token}` };

                // Parallel fetch for stats, revenue, and high-value orders
                const [statsRes, revenueRes, ordersRes] = await Promise.all([
                    fetch('/api/admin/stats', { headers }),
                    fetch('/api/admin/stats/revenue', { headers }),
                    fetch('/api/admin/stats/high-value', { headers })
                ]);

                if (statsRes.ok) {
                    const data = await statsRes.json();
                    setStats(data);
                }

                if (revenueRes.ok) {
                    const data = await revenueRes.json();
                    setRevenueData(data.chartData);
                }

                if (ordersRes.ok) {
                    const data = await ordersRes.json();
                    setHighValueOrders(data.orders);
                }

            } catch (err) {
                console.error('Error fetching dashboard data:', err);
                setError('Failed to load dashboard data');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-[#4b2192]" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
                {error}
            </div>
        );
    }

    const kpiCards = [
        {
            title: 'Total Revenue',
            subtitle: 'All Time',
            value: `₹${(stats?.totalRevenue || 0).toLocaleString('en-IN')}`,
            trend: '+12.5%',
            trendUp: true,
            icon: DollarSign,
            color: 'text-green-600',
            bgColor: 'bg-green-100',
        },
        {
            title: 'Total Users',
            subtitle: `+${stats?.newUsersToday || 0} today`,
            value: (stats?.totalUsers || 0).toLocaleString(),
            trend: '+8.2%',
            trendUp: true,
            icon: Users,
            color: 'text-blue-600',
            bgColor: 'bg-blue-100',
        },
        {
            title: 'Total Orders',
            subtitle: `${stats?.ordersToday || 0} today`,
            value: (stats?.totalOrders || 0).toLocaleString(),
            icon: ShoppingCart,
            color: 'text-purple-600',
            bgColor: 'bg-purple-100',
        },
        {
            title: 'Pending Reports',
            subtitle: 'Awaiting Processing',
            value: (stats?.pendingReports || 0).toString(),
            icon: FileText,
            color: 'text-yellow-600',
            bgColor: 'bg-yellow-100',
        },
        {
            title: 'Total Wallet Balance',
            subtitle: 'System Liability',
            value: `₹${(stats?.totalWalletBalance || 0).toLocaleString('en-IN')}`,
            icon: Wallet,
            color: 'text-indigo-600',
            bgColor: 'bg-indigo-100',
        },
        {
            title: 'Referral Payouts',
            subtitle: 'This Week',
            value: `₹${(stats?.referralPayoutsThisWeek || 0).toLocaleString('en-IN')}`,
            trend: '+15.7%',
            trendUp: true,
            icon: Gift,
            color: 'text-pink-600',
            bgColor: 'bg-pink-100',
        },
    ];

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-semibold text-gray-900">Command Center</h1>
                <p className="text-gray-600 mt-1">
                    Overview of your health-tech platform performance
                </p>
            </div>

            {/* KPI Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {kpiCards.map((kpi, index) => (
                    <KPICard key={index} {...kpi} />
                ))}
            </div>

            {/* Revenue Chart */}
            <div className="bg-white rounded-xl p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Revenue Trend (Last 30 Days)
                </h3>
                <div className="h-80 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={revenueData}>
                            <defs>
                                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#8884d8" stopOpacity={0.8} />
                                    <stop offset="95%" stopColor="#8884d8" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis
                                dataKey="date"
                                tick={{ fontSize: 12, fill: '#6b7280' }}
                                axisLine={false}
                                tickLine={false}
                            />
                            <YAxis
                                tick={{ fontSize: 12, fill: '#6b7280' }}
                                axisLine={false}
                                tickLine={false}
                                tickFormatter={(value) => `₹${value}`}
                            />
                            <Tooltip
                                formatter={(value) => [`₹${(value as number)?.toLocaleString('en-IN') || '0'}`, 'Revenue']}
                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                            />
                            <Area
                                type="monotone"
                                dataKey="revenue"
                                stroke="#8884d8"
                                fillOpacity={1}
                                fill="url(#colorRevenue)"
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Recent Orders & Quick Actions */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-xl p-6 shadow-sm">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center justify-between">
                        <span>Recent High-Value Orders</span>
                        <span className="text-xs font-normal text-gray-500 bg-gray-100 px-2 py-1 rounded-full">{'>'} ₹2,000</span>
                    </h3>

                    {highValueOrders.length === 0 ? (
                        <div className="text-gray-500 text-center py-8">
                            No high-value orders yet
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {highValueOrders.map((order) => (
                                <div key={order.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                                    <div>
                                        <p className="font-medium text-gray-900">{order.user.name || 'Unknown User'}</p>
                                        <p className="text-xs text-gray-500">{new Date(order.createdAt).toLocaleDateString()}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-bold text-[#4b2192]">₹{order.totalAmount.toLocaleString('en-IN')}</p>
                                        <p className="text-xs text-gray-500">{order.status}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="bg-white rounded-xl p-6 shadow-sm">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">
                        Quick Actions
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                        <button className="p-4 border border-gray-200 rounded-xl hover:bg-purple-50 hover:border-purple-200 transition-colors group text-left">
                            <div className="bg-purple-100 w-10 h-10 rounded-lg flex items-center justify-center mb-3 group-hover:bg-purple-200 transition-colors">
                                <Users size={20} className="text-purple-600" />
                            </div>
                            <p className="font-medium text-gray-900">Add User</p>
                            <p className="text-xs text-gray-500 mt-1">Create new account</p>
                        </button>
                        <button className="p-4 border border-gray-200 rounded-xl hover:bg-blue-50 hover:border-blue-200 transition-colors group text-left">
                            <div className="bg-blue-100 w-10 h-10 rounded-lg flex items-center justify-center mb-3 group-hover:bg-blue-200 transition-colors">
                                <Wallet size={20} className="text-blue-600" />
                            </div>
                            <p className="font-medium text-gray-900">Refund</p>
                            <p className="text-xs text-gray-500 mt-1">Process wallet refund</p>
                        </button>
                        <button className="p-4 border border-gray-200 rounded-xl hover:bg-green-50 hover:border-green-200 transition-colors group text-left">
                            <div className="bg-green-100 w-10 h-10 rounded-lg flex items-center justify-center mb-3 group-hover:bg-green-200 transition-colors">
                                <Gift size={20} className="text-green-600" />
                            </div>
                            <p className="font-medium text-gray-900">Rewards</p>
                            <p className="text-xs text-gray-500 mt-1">Config referral bonus</p>
                        </button>
                        <button className="p-4 border border-gray-200 rounded-xl hover:bg-orange-50 hover:border-orange-200 transition-colors group text-left">
                            <div className="bg-orange-100 w-10 h-10 rounded-lg flex items-center justify-center mb-3 group-hover:bg-orange-200 transition-colors">
                                <FileText size={20} className="text-orange-600" />
                            </div>
                            <p className="font-medium text-gray-900">Exports</p>
                            <p className="text-xs text-gray-500 mt-1">Download reports</p>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default DashboardPage;
