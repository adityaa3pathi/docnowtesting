'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
    Package,
    CheckCircle,
    XCircle,
    DollarSign,
    TrendingUp,
    Loader2,
    RefreshCw,
} from 'lucide-react';

interface CatalogStats {
    total: number;
    enabled: number;
    disabled: number;
}

export default function DashboardOverview() {
    const [stats, setStats] = useState<CatalogStats | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchStats();
    }, []);

    const fetchStats = async () => {
        const token = localStorage.getItem('docnow_auth_token');
        try {
            // Fetch all items to compute stats
            const res = await fetch('/api/manager/catalog?limit=9999', {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                const data = await res.json();
                const items = data.items || [];
                setStats({
                    total: items.length,
                    enabled: items.filter((i: any) => i.isEnabled).length,
                    disabled: items.filter((i: any) => !i.isEnabled).length,
                });
            }
        } catch { /* ignore */ }
        setLoading(false);
    };

    const kpis = stats ? [
        {
            title: 'Total Products',
            value: stats.total.toString(),
            subtitle: 'In catalog',
            icon: Package,
            color: '#4b2192',
        },
        {
            title: 'Active Products',
            value: stats.enabled.toString(),
            subtitle: `${stats.total > 0 ? Math.round((stats.enabled / stats.total) * 100) : 0}% enabled`,
            icon: CheckCircle,
            color: '#10b981',
        },
        {
            title: 'Disabled Products',
            value: stats.disabled.toString(),
            subtitle: `${stats.total > 0 ? Math.round((stats.disabled / stats.total) * 100) : 0}% disabled`,
            icon: XCircle,
            color: '#6b7280',
        },
    ] : [];

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-semibold text-gray-900">Dashboard</h1>
                <p className="text-gray-600 mt-1">Welcome back! Here&apos;s your catalog overview.</p>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {kpis.map((kpi, index) => {
                    const Icon = kpi.icon;
                    return (
                        <div key={index} className="bg-white rounded-xl p-6 shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
                            <div className="flex items-center justify-between pb-2">
                                <p className="text-sm font-medium text-gray-600">{kpi.title}</p>
                                <div
                                    className="h-10 w-10 rounded-lg flex items-center justify-center"
                                    style={{ backgroundColor: `${kpi.color}15` }}
                                >
                                    <Icon className="h-5 w-5" style={{ color: kpi.color }} />
                                </div>
                            </div>
                            <div className="text-3xl font-semibold text-gray-900">{kpi.value}</div>
                            <div className="flex items-center gap-1 mt-2">
                                <p className="text-sm text-gray-500">{kpi.subtitle}</p>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Quick Actions */}
            <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <Link href="/manager/catalog" className="block">
                        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer">
                            <div className="flex items-center gap-4">
                                <div className="h-12 w-12 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#4b219215' }}>
                                    <Package className="h-6 w-6" style={{ color: '#4b2192' }} />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-gray-900">Manage Catalog</h3>
                                    <p className="text-sm text-gray-500">View and edit products</p>
                                </div>
                            </div>
                        </div>
                    </Link>

                    <Link href="/manager/payment-links" className="block">
                        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer">
                            <div className="flex items-center gap-4">
                                <div className="h-12 w-12 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#4b219215' }}>
                                    <DollarSign className="h-6 w-6" style={{ color: '#4b2192' }} />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-gray-900">Create Payment Link</h3>
                                    <p className="text-sm text-gray-500">Generate new link</p>
                                </div>
                            </div>
                        </div>
                    </Link>

                    <Link href="/manager/catalog" className="block">
                        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer">
                            <div className="flex items-center gap-4">
                                <div className="h-12 w-12 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#10b98115' }}>
                                    <RefreshCw className="h-6 w-6 text-green-600" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-gray-900">Sync Products</h3>
                                    <p className="text-sm text-gray-500">From Healthians API</p>
                                </div>
                            </div>
                        </div>
                    </Link>
                </div>
            </div>
        </div>
    );
}
