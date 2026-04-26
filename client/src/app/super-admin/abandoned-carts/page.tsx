'use client';

import { useState, useEffect } from 'react';
import { 
    ShoppingBag, 
    Search, 
    Clock, 
    User, 
    Phone, 
    Mail, 
    IndianRupee, 
    ArrowRight,
    Loader2,
    Calendar,
    Filter
} from 'lucide-react';
import api from '@/lib/api';
const formatDistanceToNow = (date: Date) => {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " years ago";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " months ago";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " days ago";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " hours ago";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + " minutes ago";
    return Math.floor(seconds) + " seconds ago";
};
import toast from 'react-hot-toast';

interface AbandonedCart {
    id: string;
    userId: string;
    userName: string | null;
    userMobile: string;
    userEmail: string | null;
    lastActivityAt: string;
    itemCount: number;
    totalValue: number;
    items: Array<{
        testCode: string;
        testName: string;
        price: number;
    }>;
}

export default function AbandonedCartsPage() {
    const [carts, setCarts] = useState<AbandonedCart[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [threshold, setThreshold] = useState(30);

    useEffect(() => {
        fetchAbandonedCarts();
    }, [threshold]);

    const fetchAbandonedCarts = async () => {
        setLoading(true);
        try {
            const res = await api.get(`/admin/abandoned-carts?threshold=${threshold}`);
            setCarts(res.data);
        } catch (error) {
            console.error('Error fetching abandoned carts:', error);
            toast.error('Failed to load abandoned carts');
        } finally {
            setLoading(false);
        }
    };

    const filteredCarts = carts.filter(cart => 
        (cart.userName?.toLowerCase().includes(searchTerm.toLowerCase()) || 
        cart.userMobile.includes(searchTerm) ||
        cart.userEmail?.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Abandoned Carts</h1>
                    <p className="text-slate-500 text-sm">Track users who left items in their cart without completing checkout</p>
                </div>
                <div className="flex items-center gap-3 bg-white p-1 rounded-lg border border-slate-200 shadow-sm">
                    <button 
                        onClick={() => setThreshold(15)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${threshold === 15 ? 'bg-[#4b2192] text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}
                    >
                        15m
                    </button>
                    <button 
                        onClick={() => setThreshold(30)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${threshold === 30 ? 'bg-[#4b2192] text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}
                    >
                        30m
                    </button>
                    <button 
                        onClick={() => setThreshold(60)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${threshold === 60 ? 'bg-[#4b2192] text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}
                    >
                        1h
                    </button>
                    <button 
                        onClick={() => setThreshold(1440)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${threshold === 1440 ? 'bg-[#4b2192] text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}
                    >
                        24h
                    </button>
                </div>
            </div>

            {/* Filters and Search */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-col md:flex-row gap-4 items-center">
                <div className="relative flex-1 w-full">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                    <input 
                        type="text"
                        placeholder="Search by name, mobile or email..."
                        className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192] transition-all text-sm"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="flex items-center gap-2 text-slate-500 text-sm whitespace-nowrap">
                    <Filter className="w-4 h-4" />
                    <span>{filteredCarts.length} potential conversions found</span>
                </div>
            </div>

            {loading ? (
                <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-20 flex flex-col items-center justify-center gap-4">
                    <Loader2 className="w-8 h-8 animate-spin text-[#4b2192]" />
                    <p className="text-slate-500 animate-pulse font-medium">Analyzing cart abandonment data...</p>
                </div>
            ) : filteredCarts.length === 0 ? (
                <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-20 flex flex-col items-center justify-center text-center gap-4">
                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center">
                        <ShoppingBag className="w-8 h-8 text-slate-300" />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-slate-900">No abandoned carts found</h3>
                        <p className="text-slate-500 max-w-xs mx-auto mt-1">Great news! It looks like all active carts have either completed checkout or are still within their active window.</p>
                    </div>
                </div>
            ) : (
                <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50/50 border-b border-slate-100">
                                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">User Details</th>
                                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Cart Contents</th>
                                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 text-center">Value</th>
                                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Last Active</th>
                                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filteredCarts.map((cart) => (
                                    <tr key={cart.id} className="hover:bg-slate-50/50 transition-colors group">
                                        <td className="px-6 py-4">
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-2 font-semibold text-slate-900">
                                                    <User className="w-3.5 h-3.5 text-[#4b2192]" />
                                                    {cart.userName || 'Guest User'}
                                                </div>
                                                <div className="flex items-center gap-2 text-xs text-slate-500">
                                                    <Phone className="w-3 h-3" />
                                                    {cart.userMobile}
                                                </div>
                                                {cart.userEmail && (
                                                    <div className="flex items-center gap-2 text-xs text-slate-500">
                                                        <Mail className="w-3 h-3" />
                                                        {cart.userEmail}
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="space-y-1.5 max-w-md">
                                                <div className="flex items-center gap-2">
                                                    <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase">
                                                        {cart.itemCount} {cart.itemCount === 1 ? 'Item' : 'Items'}
                                                    </span>
                                                </div>
                                                <div className="text-sm text-slate-600 line-clamp-2 italic">
                                                    {cart.items.map(i => i.testName).join(', ')}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <div className="inline-flex items-center gap-1 font-bold text-slate-900 bg-slate-100 px-2 py-1 rounded-lg">
                                                <IndianRupee className="w-3 h-3" />
                                                {cart.totalValue.toLocaleString()}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col gap-1">
                                                <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                                                    <Clock className="w-3.5 h-3.5 text-amber-500" />
                                                    {formatDistanceToNow(new Date(cart.lastActivityAt))}
                                                </div>
                                                <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                                                    <Calendar className="w-2.5 h-2.5" />
                                                    {new Date(cart.lastActivityAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <button 
                                                onClick={() => toast.success('Follow-up feature coming soon!')}
                                                className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#4b2192]/5 hover:bg-[#4b2192] text-[#4b2192] hover:text-white text-xs font-bold rounded-lg transition-all border border-[#4b2192]/10"
                                            >
                                                Details
                                                <ArrowRight className="w-3 h-3" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
