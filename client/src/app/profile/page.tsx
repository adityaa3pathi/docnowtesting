"use client";

import { Header } from '@/components/Header';
import { WalletTab } from '@/components/profile/WalletTab';
import { User, Users, FileText, Calendar, Loader2, Shield, Wallet } from 'lucide-react';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { ProfileTab } from '@/components/profile/ProfileTab';
import { FamilyTab } from '@/components/profile/FamilyTab';
import { BookingsTab } from '@/components/profile/BookingsTab';
import { ReportsTab } from '@/components/profile/ReportsTab';
import Link from 'next/link';

type Tab = 'profile' | 'family' | 'bookings' | 'reports' | 'wallet';

export default function ProfilePage() {
    const { isAuthenticated, isInitialized, user } = useAuth();
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<Tab>('profile');

    useEffect(() => {
        if (isInitialized && !isAuthenticated) {
            router.push('/');
        }
    }, [isAuthenticated, isInitialized, router]);

    if (!isInitialized || !isAuthenticated) {
        return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;
    }

    const isSuperAdmin = user?.role === 'SUPER_ADMIN';
    const isManager = user?.role === 'MANAGER';

    return (
        <div className="min-h-screen bg-gray-50 pb-20">
            <Header />

            <div className="container mx-auto px-4 py-8">
                <h1 className="text-3xl font-bold text-slate-900 mb-8">My Account</h1>

                <div className="grid md:grid-cols-4 gap-6 md:gap-8">
                    {/* Sidebar Navigation — horizontal tabs on mobile, vertical sidebar on desktop */}
                    <div className="md:col-span-1">
                        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden md:sticky md:top-20">
                            <nav className="p-2 flex md:flex-col gap-1 overflow-x-auto md:overflow-x-visible scrollbar-hide">
                                <NavButton
                                    icon={<User className="w-4 h-4" />}
                                    label="Profile"
                                    active={activeTab === 'profile'}
                                    onClick={() => setActiveTab('profile')}
                                />
                                <NavButton
                                    icon={<Users className="w-4 h-4" />}
                                    label="Family"
                                    active={activeTab === 'family'}
                                    onClick={() => setActiveTab('family')}
                                />
                                <NavButton
                                    icon={<Calendar className="w-4 h-4" />}
                                    label="Bookings"
                                    active={activeTab === 'bookings'}
                                    onClick={() => setActiveTab('bookings')}
                                />
                                <NavButton
                                    icon={<Wallet className="w-4 h-4" />}
                                    label="Wallet"
                                    active={activeTab === 'wallet'}
                                    onClick={() => setActiveTab('wallet')}
                                />
                                <NavButton
                                    icon={<FileText className="w-4 h-4" />}
                                    label="Reports"
                                    active={activeTab === 'reports'}
                                    onClick={() => setActiveTab('reports')}
                                />
                            </nav>

                            {/* Manager / Admin Panel Links */}
                            {(isManager || isSuperAdmin) && (
                                <div className="p-2 pt-0 border-t border-gray-100 mt-1 md:mt-2 flex md:flex-col gap-2 overflow-x-auto md:overflow-x-visible scrollbar-hide">
                                    <Link
                                        href="/manager"
                                        className="flex items-center gap-2 md:gap-3 flex-shrink-0 md:w-full px-3 md:px-4 py-2 md:py-3 rounded-lg text-xs md:text-sm font-medium transition-colors bg-gradient-to-r from-teal-600 to-emerald-600 text-white hover:from-teal-700 hover:to-emerald-700 whitespace-nowrap"
                                    >
                                        <Shield className="w-3.5 h-3.5 md:w-4 md:h-4" />
                                        Manager
                                    </Link>
                                    {isSuperAdmin && (
                                        <Link
                                            href="/super-admin"
                                            className="flex items-center gap-2 md:gap-3 flex-shrink-0 md:w-full px-3 md:px-4 py-2 md:py-3 rounded-lg text-xs md:text-sm font-medium transition-colors bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700 whitespace-nowrap"
                                        >
                                            <Shield className="w-3.5 h-3.5 md:w-4 md:h-4" />
                                            Admin
                                        </Link>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Main Content Area */}
                    <div className="md:col-span-3">
                        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 md:p-8 min-h-[500px]">
                            {activeTab === 'profile' && <ProfileTab />}
                            {activeTab === 'family' && <FamilyTab />}
                            {activeTab === 'bookings' && <BookingsTab />}
                            {activeTab === 'wallet' && <WalletTab />}
                            {activeTab === 'reports' && <ReportsTab />}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function NavButton({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "flex items-center gap-2 md:gap-3 flex-shrink-0 px-3 py-2 md:px-4 md:py-3 md:w-full rounded-lg text-xs md:text-sm font-medium transition-colors whitespace-nowrap",
                active ? "bg-primary/10 text-primary" : "text-gray-600 hover:bg-gray-50"
            )}
        >
            {icon}
            {label}
        </button>
    )
}
