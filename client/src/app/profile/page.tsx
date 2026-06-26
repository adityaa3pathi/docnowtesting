"use client";

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { User, Users, FileText, Calendar, Loader2, Shield, Wallet, Gift, LogOut, ChevronRight, IndianRupee } from 'lucide-react';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import api from '@/lib/api';

// Lazy-load tab components — only downloaded when user opens a dialog
const ProfileTab = dynamic(() => import('@/components/profile/ProfileTab').then(m => ({ default: m.ProfileTab })), {
    loading: () => <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>,
});
const FamilyTab = dynamic(() => import('@/components/profile/FamilyTab').then(m => ({ default: m.FamilyTab })), {
    loading: () => <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>,
});
const BookingsTab = dynamic(() => import('@/components/profile/BookingsTab').then(m => ({ default: m.BookingsTab })), {
    loading: () => <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>,
});
const WalletTab = dynamic(() => import('@/components/profile/WalletTab').then(m => ({ default: m.WalletTab })), {
    loading: () => <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>,
});
const ReferralTab = dynamic(() => import('@/components/profile/ReferralTab').then(m => ({ default: m.ReferralTab })), {
    loading: () => <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>,
});
const ReportsTab = dynamic(() => import('@/components/profile/ReportsTab').then(m => ({ default: m.ReportsTab })), {
    loading: () => <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>,
});


// --- BENTO BOX COMPONENT ---
function BentoCard({ title, icon, value, subtitle, children, className, gradient, onClick, isLink }: any) {
    const cardContent = (
        <div 
            onClick={!children ? onClick : undefined}
            className={`relative overflow-hidden rounded-3xl p-4 sm:p-5 shadow-sm border border-gray-100 flex flex-col transition-all active:scale-[0.98] cursor-pointer hover:shadow-md h-full bg-white group ${className}`}
        >
            {gradient && <div className={`absolute inset-0 opacity-[0.07] bg-gradient-to-br ${gradient}`} />}
            <div className="relative z-10 flex items-center justify-between mb-1.5 sm:mb-3 text-gray-500 group-hover:text-gray-700 transition-colors">
                <div className="flex items-center gap-1.5 sm:gap-2">
                    {icon}
                    <span className="font-semibold text-xs sm:text-sm">{title}</span>
                </div>
                <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity -translate-x-2 group-hover:translate-x-0" />
            </div>
            <div className="relative z-10 flex-1 flex flex-col justify-end min-h-0">
                {value && <div className="text-xl sm:text-3xl font-bold text-gray-900 truncate">{value}</div>}
                {subtitle && <div className="text-[11px] sm:text-xs text-gray-600 font-medium mt-0.5 sm:mt-1 truncate">{subtitle}</div>}
            </div>
        </div>
    );

    if (isLink) {
        return cardContent;
    }

    if (!children) return cardContent;

    return (
        <Dialog>
            <DialogTrigger asChild>
                {cardContent}
            </DialogTrigger>
            <DialogContent className="w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto p-4 sm:p-6 bg-white sm:bg-gray-50 !rounded-3xl">
                <div className="bg-white sm:rounded-2xl sm:shadow-sm sm:p-6">
                    {children}
                </div>
            </DialogContent>
        </Dialog>
    );
}

export default function ProfilePage() {
    const { isAuthenticated, isInitialized, user, logout } = useAuth();
    const router = useRouter();
    
    const [walletBalance, setWalletBalance] = useState<number | null>(null);
    const [familyCount, setFamilyCount] = useState<number | null>(null);
    const [activeBookingsCount, setActiveBookingsCount] = useState<number | null>(null);

    useEffect(() => {
        if (isInitialized && !isAuthenticated) {
            router.push('/');
        }
    }, [isAuthenticated, isInitialized, router]);

    useEffect(() => {
        if (!isAuthenticated) return;
        
        // Fetch summaries
        api.get('/profile/wallet').then(res => setWalletBalance(res.data.balance || 0)).catch(() => {});
        api.get('/profile/patients').then(res => setFamilyCount(res.data.length || 0)).catch(() => {});
        api.get('/bookings').then(res => {
            const bookings = res.data || [];
            const active = bookings.filter((b: any) => !b.superseded && b.status !== 'Cancelled' && b.status !== 'Completed').length;
            setActiveBookingsCount(active);
        }).catch(() => {});
    }, [isAuthenticated]);

    if (!isInitialized || !isAuthenticated) {
        return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;
    }

    const isSuperAdmin = user?.role === 'SUPER_ADMIN';
    const isManager = user?.role === 'MANAGER';

    return (
        <div className="bg-gray-100 flex flex-col" style={{ height: 'calc(100dvh - 73px)', overflow: 'hidden' }}>
            <div className="flex-1 w-full max-w-5xl mx-auto px-4 py-4 sm:py-6 flex flex-col gap-4 overflow-hidden">
                
                {/* Header Section */}
                <div className="flex justify-between items-center px-1 flex-shrink-0">
                    <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
                    <button 
                        onClick={logout}
                        className="flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-red-100 text-red-600 hover:bg-red-50 text-sm font-medium transition-colors shadow-sm"
                    >
                        <LogOut className="w-4 h-4" />
                        <span className="hidden sm:inline">Log Out</span>
                    </button>
                </div>

                {/* Grid Layout strictly fills remaining height */}
                <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 grid-rows-3 sm:grid-rows-3 gap-3 sm:gap-4 h-full min-h-0">
                    
                    {/* User Identity - Large Top Left */}
                    <BentoCard 
                        className="col-span-2 row-span-1 sm:row-span-1 border-none shadow-md"
                        gradient="from-blue-600 to-indigo-600"
                        title="Profile" 
                        icon={<User className="w-4 h-4" />}
                        value={user?.name || 'User'}
                        subtitle={[user?.email, user?.mobile].filter(Boolean).join(' • ') || 'Complete your profile'}
                    >
                        <ProfileTab />
                    </BentoCard>

                    {/* Wallet - Square */}
                    <BentoCard 
                        className="col-span-1 row-span-1 sm:col-span-1 sm:row-span-1 border-none shadow-md"
                        gradient="from-[#4b2192] to-[#6d3fcf]"
                        title="Wallet" 
                        icon={<Wallet className="w-4 h-4" />}
                        value={walletBalance !== null ? `₹${walletBalance.toLocaleString('en-IN')}` : '...'}
                        subtitle="Available balance"
                    >
                        <WalletTab />
                    </BentoCard>

                    {/* Bookings - Square */}
                    <BentoCard 
                        className="col-span-1 row-span-1 sm:col-span-1 sm:row-span-1 border-none shadow-md"
                        gradient="from-emerald-600 to-teal-600"
                        title="Bookings" 
                        icon={<Calendar className="w-4 h-4" />}
                        value={activeBookingsCount !== null ? activeBookingsCount : '...'}
                        subtitle="Active appointments"
                    >
                        <BookingsTab />
                    </BentoCard>

                    {/* Family - Wide bottom left */}
                    <BentoCard 
                        className="col-span-2 row-span-1 sm:col-span-2 sm:row-span-1 border-none shadow-md"
                        gradient="from-orange-500 to-amber-500"
                        title="Family Members" 
                        icon={<Users className="w-4 h-4" />}
                        value={familyCount !== null ? `${familyCount} Members` : '...'}
                        subtitle="Manage your family profiles"
                    >
                        <FamilyTab />
                    </BentoCard>

                    {/* Reports - Small */}
                    <BentoCard 
                        className="col-span-1 row-span-1 sm:col-span-1 sm:row-span-1 border-none shadow-md"
                        gradient="from-rose-500 to-pink-500"
                        title="Reports" 
                        icon={<FileText className="w-4 h-4" />}
                        subtitle="View health records"
                    >
                        <ReportsTab />
                    </BentoCard>

                    {/* Referrals - Small */}
                    <BentoCard 
                        className="col-span-1 row-span-1 sm:col-span-1 sm:row-span-1 border-none shadow-md"
                        gradient="from-violet-500 to-fuchsia-500"
                        title="Referrals" 
                        icon={<Gift className="w-4 h-4" />}
                        subtitle="Invite & earn rewards"
                    >
                        <ReferralTab />
                    </BentoCard>

                    {/* Manager/Admin Area - Desktop only */}
                    {(isManager || isSuperAdmin) && (
                        <div className="hidden sm:flex col-span-4 row-span-1 gap-3 min-h-0">
                            <Link href="/manager" className="flex-1 group">
                                <div className="h-full relative overflow-hidden rounded-3xl p-5 shadow-sm border-none bg-gradient-to-r from-teal-600 to-emerald-600 text-white flex flex-col justify-center items-center transition-transform active:scale-[0.98] hover:shadow-lg">
                                    <Shield className="w-6 h-6 mb-2 opacity-80 group-hover:scale-110 transition-transform" />
                                    <span className="font-bold text-sm">Manager Portal</span>
                                </div>
                            </Link>
                            {isSuperAdmin && (
                                <Link href="/super-admin" className="flex-1 group">
                                    <div className="h-full relative overflow-hidden rounded-3xl p-5 shadow-sm border-none bg-gradient-to-r from-purple-600 to-indigo-600 text-white flex flex-col justify-center items-center transition-transform active:scale-[0.98] hover:shadow-lg">
                                        <Shield className="w-6 h-6 mb-2 opacity-80 group-hover:scale-110 transition-transform" />
                                        <span className="font-bold text-sm">Admin Portal</span>
                                    </div>
                                </Link>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
