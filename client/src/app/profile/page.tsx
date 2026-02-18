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

                <div className="grid md:grid-cols-4 gap-8">
                    {/* Sidebar Navigation */}
                    <div className="md:col-span-1">
                        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden sticky top-20">
                            <nav className="p-2 space-y-1">
                                <NavButton
                                    icon={<User className="w-4 h-4" />}
                                    label="Profile & Address"
                                    active={activeTab === 'profile'}
                                    onClick={() => setActiveTab('profile')}
                                />
                                <NavButton
                                    icon={<Users className="w-4 h-4" />}
                                    label="Family Members"
                                    active={activeTab === 'family'}
                                    onClick={() => setActiveTab('family')}
                                />
                                <NavButton
                                    icon={<Calendar className="w-4 h-4" />}
                                    label="My Bookings"
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
                                <div className="p-2 pt-0 border-t border-gray-100 mt-2 space-y-2">
                                    <Link
                                        href="/manager"
                                        className="flex items-center gap-3 w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors bg-gradient-to-r from-teal-600 to-emerald-600 text-white hover:from-teal-700 hover:to-emerald-700"
                                    >
                                        <Shield className="w-4 h-4" />
                                        Manager Dashboard
                                    </Link>
                                    {isSuperAdmin && (
                                        <Link
                                            href="/super-admin"
                                            className="flex items-center gap-3 w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700"
                                        >
                                            <Shield className="w-4 h-4" />
                                            Admin Panel
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
                "flex items-center gap-3 w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors text-left",
                active ? "bg-primary/10 text-primary" : "text-gray-600 hover:bg-gray-50"
            )}
        >
            {icon}
            {label}
        </button>
    )
}
