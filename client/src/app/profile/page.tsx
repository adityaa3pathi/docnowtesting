"use client";

import { useState, useEffect, Suspense } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { User, Users, FileText, Calendar, Loader2, Shield, Wallet, Gift, LogOut, ChevronRight, IndianRupee, Stethoscope } from 'lucide-react';
import { Dialog, DialogContent, DialogTrigger, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
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
interface BentoCardProps {
    title: string;
    icon: React.ReactNode;
    value?: string | number | null;
    subtitle?: string | null;
    children?: React.ReactNode;
    className?: string;
    gradient?: string;
    onClick?: () => void;
    isLink?: boolean;
    isOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
}

function BentoCard({
    title,
    icon,
    value,
    subtitle,
    children,
    className,
    gradient,
    onClick,
    isLink,
    isOpen,
    onOpenChange,
}: BentoCardProps) {
    const cardContent = (
        <div
            onClick={!children ? onClick : undefined}
            className={`group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-3xl border border-gray-100 bg-white p-4 shadow-sm transition-all hover:scale-[1.02] hover:shadow-xl active:scale-[0.98] sm:p-6 ${className}`}
        >
            {gradient && <div className={`absolute inset-0 bg-gradient-to-br opacity-[0.08] transition-opacity group-hover:opacity-[0.12] ${gradient}`} />}
            <div className="relative z-10 mb-3 flex items-center justify-between text-gray-500 transition-colors group-hover:text-gray-700 sm:mb-4">
                <div className="flex items-center gap-2">
                    {icon}
                    <span className="text-xs font-bold sm:text-sm">{title}</span>
                </div>
                <ChevronRight className="h-4 w-4 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" aria-hidden />
            </div>
            <div className="relative z-10 flex flex-1 flex-col justify-end">
                {value && <div className="truncate text-2xl font-black text-gray-900 sm:text-3xl">{value}</div>}
                {subtitle && <div className="mt-1 truncate text-xs font-medium text-gray-600 sm:text-sm">{subtitle}</div>}
            </div>
        </div>
    );

    if (isLink) {
        return cardContent;
    }

    if (!children) return cardContent;

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogTrigger asChild>
                {cardContent}
            </DialogTrigger>
            <DialogContent className="w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto p-4 sm:p-6 bg-white sm:bg-gray-50 !rounded-3xl">
                <DialogHeader className="sr-only">
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{subtitle || title}</DialogDescription>
                </DialogHeader>
                <div className="bg-white sm:rounded-2xl sm:shadow-sm sm:p-6">
                    {children}
                </div>
            </DialogContent>
        </Dialog>
    );
}

function ProfilePageContent() {
    const { isAuthenticated, isInitialized, user, logout } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();
    
    const [walletBalance, setWalletBalance] = useState<number | null>(null);
    const [familyCount, setFamilyCount] = useState<number | null>(null);
    const [activeBookingsCount, setActiveBookingsCount] = useState<number | null>(null);
    const [activeTab, setActiveTab] = useState<string | null>(null);

    useEffect(() => {
        const tab = searchParams.get('tab');
        if (tab) {
            const normalized = tab === 'orders' ? 'bookings' : tab === 'patients' ? 'family' : tab;
            setActiveTab(normalized);
        } else {
            setActiveTab(null);
        }
    }, [searchParams]);

    const handleTabChange = (tabId: string, open: boolean) => {
        if (open) {
            setActiveTab(tabId);
            router.replace(`/profile?tab=${tabId}`, { scroll: false });
        } else {
            setActiveTab(null);
            router.replace('/profile', { scroll: false });
        }
    };

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
        <div className="min-h-screen w-full bg-gray-100 pb-8">
            {/* Purple Header Bar */}
            <div
                className="w-full px-4 py-6 sm:px-6 sm:py-8"
                style={{ background: 'linear-gradient(135deg, #4b2192 0%, #6d3fcf 100%)' }}
            >
                <div className="mx-auto flex max-w-6xl items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-black text-white sm:text-3xl">
                            Welcome back, {user?.name?.split(' ')[0] || 'User'}!
                        </h1>
                        <p className="mt-1 text-sm font-medium text-white/80 sm:text-base">
                            Manage your health and appointments
                        </p>
                    </div>
                    <button
                        onClick={logout}
                        className="flex items-center gap-2 rounded-full border-2 border-white/20 bg-white/10 px-4 py-2 text-sm font-bold text-white backdrop-blur-sm transition-all hover:bg-white/20 active:scale-95"
                    >
                        <LogOut className="h-4 w-4" aria-hidden />
                        <span className="hidden sm:inline">Log Out</span>
                    </button>
                </div>
            </div>

            {/* Bento Grid */}
            <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
                    
                    {/* User Identity */}
                    <BentoCard
                        className="col-span-2 min-h-[120px] border-none shadow-lg sm:min-h-[140px]"
                        gradient="from-blue-600 to-indigo-600"
                        title="Profile"
                        icon={<User className="h-4 w-4" />}
                        value={user?.name || 'User'}
                        subtitle={[user?.email, user?.mobile].filter(Boolean).join(' • ') || 'Complete your profile'}
                        isOpen={activeTab === 'profile'}
                        onOpenChange={(open) => handleTabChange('profile', open)}
                    >
                        <ProfileTab />
                    </BentoCard>

                    {/* Wallet */}
                    <BentoCard
                        className="col-span-1 min-h-[120px] border-none shadow-lg sm:min-h-[140px]"
                        gradient="from-[#4b2192] to-[#6d3fcf]"
                        title="Wallet"
                        icon={<Wallet className="h-4 w-4" />}
                        value={walletBalance !== null ? `₹${walletBalance.toLocaleString('en-IN')}` : '...'}
                        subtitle="Available balance"
                        isOpen={activeTab === 'wallet'}
                        onOpenChange={(open) => handleTabChange('wallet', open)}
                    >
                        <WalletTab />
                    </BentoCard>

                    {/* Bookings */}
                    <BentoCard
                        className="col-span-1 min-h-[120px] border-none shadow-lg sm:min-h-[140px]"
                        gradient="from-emerald-600 to-teal-600"
                        title="Bookings"
                        icon={<Calendar className="h-4 w-4" />}
                        value={activeBookingsCount !== null ? activeBookingsCount : '...'}
                        subtitle="Active appointments"
                        isOpen={activeTab === 'bookings'}
                        onOpenChange={(open) => handleTabChange('bookings', open)}
                    >
                        <BookingsTab />
                    </BentoCard>

                    {/* Doctor Consultations - PROMINENT */}
                    <Link href="/consult/my" className="col-span-2 sm:col-span-2">
                        <BentoCard
                            className="min-h-[120px] border-none shadow-2xl sm:min-h-[140px]"
                            gradient="from-[#4b2192] via-purple-600 to-indigo-600"
                            title="My Consultations"
                            icon={<Stethoscope className="h-5 w-5" />}
                            value="View All"
                            subtitle="Doctor visits and prescriptions"
                            isLink
                        />
                    </Link>

                    {/* Family */}
                    <BentoCard
                        className="col-span-2 min-h-[120px] border-none shadow-lg sm:min-h-[140px]"
                        gradient="from-orange-500 to-amber-500"
                        title="Family Members"
                        icon={<Users className="h-4 w-4" />}
                        value={familyCount !== null ? `${familyCount} Members` : '...'}
                        subtitle="Manage your family profiles"
                        isOpen={activeTab === 'family'}
                        onOpenChange={(open) => handleTabChange('family', open)}
                    >
                        <FamilyTab />
                    </BentoCard>

                    {/* Reports */}
                    <BentoCard
                        className="col-span-1 min-h-[120px] border-none shadow-lg sm:min-h-[140px]"
                        gradient="from-rose-500 to-pink-500"
                        title="Reports"
                        icon={<FileText className="h-4 w-4" />}
                        subtitle="View health records"
                        isOpen={activeTab === 'reports'}
                        onOpenChange={(open) => handleTabChange('reports', open)}
                    >
                        <ReportsTab />
                    </BentoCard>

                    {/* Referrals */}
                    <BentoCard
                        className="col-span-1 min-h-[120px] border-none shadow-lg sm:min-h-[140px]"
                        gradient="from-violet-500 to-fuchsia-500"
                        title="Referrals"
                        icon={<Gift className="h-4 w-4" />}
                        subtitle="Invite & earn rewards"
                        isOpen={activeTab === 'referrals'}
                        onOpenChange={(open) => handleTabChange('referrals', open)}
                    >
                        <ReferralTab />
                    </BentoCard>

                    {/* Manager/Admin Area */}
                    {(isManager || isSuperAdmin) && (
                        <>
                            <Link href="/manager" className="group col-span-2 sm:col-span-2">
                                <div className="flex min-h-[100px] flex-col items-center justify-center overflow-hidden rounded-3xl bg-gradient-to-r from-teal-600 to-emerald-600 p-6 text-white shadow-lg transition-all hover:scale-[1.02] hover:shadow-2xl active:scale-[0.98]">
                                    <Shield className="mb-2 h-6 w-6 opacity-90 transition-transform group-hover:scale-110" aria-hidden />
                                    <span className="text-sm font-bold">Manager Portal</span>
                                </div>
                            </Link>
                            {isSuperAdmin && (
                                <Link href="/super-admin" className="group col-span-2 sm:col-span-2">
                                    <div className="flex min-h-[100px] flex-col items-center justify-center overflow-hidden rounded-3xl bg-gradient-to-r from-purple-600 to-indigo-600 p-6 text-white shadow-lg transition-all hover:scale-[1.02] hover:shadow-2xl active:scale-[0.98]">
                                        <Shield className="mb-2 h-6 w-6 opacity-90 transition-transform group-hover:scale-110" aria-hidden />
                                        <span className="text-sm font-bold">Admin Portal</span>
                                    </div>
                                </Link>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function ProfilePage() {
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>}>
            <ProfilePageContent />
        </Suspense>
    );
}
