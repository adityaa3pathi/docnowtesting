'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    Users,
    Gift,
    Clock,
    CheckCircle,
    Loader2,
    RefreshCw,
    Save,
    TrendingUp,
    UserPlus
} from 'lucide-react';

interface ReferralStats {
    totalReferrals: number;
    totalRewardsDistributed: number;
    pendingRewards: number;
}

interface LeaderboardEntry {
    id: string;
    name: string | null;
    mobile: string;
    referralCode: string | null;
    totalReferrals: number;
    totalEarnings: number;
}

interface ActivityEntry {
    id: string;
    refereeName: string | null;
    refereeMobile: string;
    referrerName: string | null;
    referrerMobile: string;
    date: string;
    status: string;
}

export default function ReferralsPage() {
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<ReferralStats | null>(null);
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [recentActivity, setRecentActivity] = useState<ActivityEntry[]>([]);

    // Config state
    const [referrerBonus, setReferrerBonus] = useState('');
    const [refereeBonus, setRefereeBonus] = useState('');
    const [configLoading, setConfigLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('docnow_auth_token');

            // Fetch Stats
            const statsRes = await fetch('/api/admin/referrals/stats', {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (statsRes.ok) {
                const data = await statsRes.json();
                setStats(data.stats);
                setLeaderboard(data.leaderboard);
                setRecentActivity(data.recentActivity);
            }

            // Fetch Config
            const configRes = await fetch('/api/admin/config', {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (configRes.ok) {
                const data = await configRes.json();
                const referrerConfig = data.configs.find((c: any) => c.key === 'REFERRAL_BONUS_REFERRER');
                const refereeConfig = data.configs.find((c: any) => c.key === 'REFERRAL_BONUS_REFEREE');

                if (referrerConfig) setReferrerBonus(referrerConfig.value);
                if (refereeConfig) setRefereeBonus(refereeConfig.value);
            }
        } catch (error) {
            console.error('Error fetching data:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleSaveConfig = async () => {
        setSaving(true);
        try {
            const token = localStorage.getItem('docnow_auth_token');

            await Promise.all([
                fetch('/api/admin/config/REFERRAL_BONUS_REFERRER', {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`
                    },
                    body: JSON.stringify({ value: referrerBonus, reason: 'Admin update from Referrals page' })
                }),
                fetch('/api/admin/config/REFERRAL_BONUS_REFEREE', {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`
                    },
                    body: JSON.stringify({ value: refereeBonus, reason: 'Admin update from Referrals page' })
                })
            ]);

            alert('Configuration saved successfully');
        } catch (error) {
            console.error('Error saving config:', error);
            alert('Failed to save configuration');
        } finally {
            setSaving(false);
        }
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        });
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-[#4b2192]" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-semibold text-gray-900">Referral Management</h1>
                    <p className="text-gray-600 mt-1">Configure rewards and monitor performance</p>
                </div>
                <button
                    onClick={fetchData}
                    className="flex items-center gap-2 px-4 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                    <RefreshCw size={16} />
                    Refresh
                </button>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-600">Total Referrals</p>
                            <p className="text-2xl font-bold text-gray-900 mt-2">{stats?.totalReferrals || 0}</p>
                        </div>
                        <div className="p-3 bg-blue-100 rounded-lg">
                            <UserPlus className="text-blue-600" size={24} />
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-600">Rewards Distributed</p>
                            <p className="text-2xl font-bold text-gray-900 mt-2">₹{(stats?.totalRewardsDistributed || 0).toLocaleString('en-IN')}</p>
                        </div>
                        <div className="p-3 bg-green-100 rounded-lg">
                            <Gift className="text-green-600" size={24} />
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-600">Pending Rewards</p>
                            <p className="text-2xl font-bold text-gray-900 mt-2">{stats?.pendingRewards || 0}</p>
                        </div>
                        <div className="p-3 bg-yellow-100 rounded-lg">
                            <Clock className="text-yellow-600" size={24} />
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Configuration Section */}
                <div className="lg:col-span-1 bg-white rounded-xl shadow-sm border border-gray-100 p-6 h-fit">
                    <h2 className="text-lg font-semibold text-gray-900 mb-6 flex items-center gap-2">
                        <Gift size={20} className="text-[#4b2192]" />
                        Reward Configuration
                    </h2>

                    <div className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Referrer Bonus (₹)
                            </label>
                            <p className="text-xs text-gray-500 mb-2">Amount credited to the person who refers</p>
                            <input
                                type="number"
                                value={referrerBonus}
                                onChange={(e) => setReferrerBonus(e.target.value)}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4b2192]"
                                placeholder="e.g. 100"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Referee Bonus (₹)
                            </label>
                            <p className="text-xs text-gray-500 mb-2">Amount credited to the new user</p>
                            <input
                                type="number"
                                value={refereeBonus}
                                onChange={(e) => setRefereeBonus(e.target.value)}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4b2192]"
                                placeholder="e.g. 50"
                            />
                        </div>

                        <button
                            onClick={handleSaveConfig}
                            disabled={saving}
                            className="w-full flex items-center justify-center gap-2 bg-[#4b2192] text-white py-2.5 rounded-lg hover:bg-[#3d1a78] transition-colors disabled:opacity-70"
                        >
                            {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                            Save Configuration
                        </button>
                    </div>
                </div>

                {/* Leaderboard & Activity */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Leaderboard */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="p-6 border-b border-gray-100">
                            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                                <TrendingUp size={20} className="text-purple-600" />
                                Top Referrers
                            </h2>
                        </div>

                        {leaderboard.length === 0 ? (
                            <p className="p-6 text-gray-500 text-center">No referral data yet</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Rank</th>
                                            <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">User</th>
                                            <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Referrals</th>
                                            <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Total Earned</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {leaderboard.map((user, index) => (
                                            <tr key={user.id} className="hover:bg-gray-50">
                                                <td className="px-6 py-4">
                                                    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${index === 0 ? 'bg-yellow-100 text-yellow-700' :
                                                            index === 1 ? 'bg-gray-100 text-gray-700' :
                                                                index === 2 ? 'bg-orange-100 text-orange-700' :
                                                                    'text-gray-500'
                                                        }`}>
                                                        {index + 1}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div>
                                                        <p className="font-medium text-gray-900">{user.name || 'Unknown'}</p>
                                                        <p className="text-xs text-gray-500">{user.mobile}</p>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 font-medium">{user.totalReferrals}</td>
                                                <td className="px-6 py-4 text-green-600 font-medium">₹{user.totalEarnings.toLocaleString('en-IN')}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {/* Recent Activity */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="p-6 border-b border-gray-100">
                            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                                <Clock size={20} className="text-blue-600" />
                                Recent Activity
                            </h2>
                        </div>

                        {recentActivity.length === 0 ? (
                            <p className="p-6 text-gray-500 text-center">No recent activity</p>
                        ) : (
                            <div className="divide-y divide-gray-100">
                                {recentActivity.map((activity) => (
                                    <div key={activity.id} className="p-4 hover:bg-gray-50 transition-colors flex items-center justify-between">
                                        <div>
                                            <p className="text-sm font-medium text-gray-900">
                                                {activity.referrerName || activity.referrerMobile} referred {activity.refereeName || activity.refereeMobile}
                                            </p>
                                            <p className="text-xs text-gray-500 mt-0.5">{formatDate(activity.date)}</p>
                                        </div>
                                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${activity.status === 'COMPLETED'
                                                ? 'bg-green-100 text-green-700'
                                                : 'bg-yellow-100 text-yellow-700'
                                            }`}>
                                            {activity.status}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
