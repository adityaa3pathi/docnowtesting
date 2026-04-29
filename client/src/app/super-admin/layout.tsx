'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
    LayoutDashboard,
    Users,
    ShoppingCart,
    ShoppingBag,
    Wallet,
    Gift,
    Settings,
    FileText,
    ChevronLeft,
    ChevronRight,
    LogOut,
    Loader2,
    Ticket,
    Menu,
    X,
    Home,
    Shield,
    PhoneCall,
    Building2,
    AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import { DocnowLogo } from '@/components/DocnowLogo';
import api, { getAccessToken } from '@/lib/api';

// Navigation items matching the design
const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/super-admin/dashboard' },
    { id: 'users', label: 'Users', icon: Users, href: '/super-admin/users' },
    { id: 'orders', label: 'Orders', icon: ShoppingCart, href: '/super-admin/orders' },
    { id: 'abandoned-carts', label: 'Abandoned Carts', icon: ShoppingBag, href: '/super-admin/abandoned-carts' },
    { id: 'wallets', label: 'Wallets', icon: Wallet, href: '/super-admin/wallets' },
    { id: 'promos', label: 'Promo Codes', icon: Ticket, href: '/super-admin/promos' },
    { id: 'callbacks', label: 'Callbacks', icon: PhoneCall, href: '/super-admin/callbacks' },
    { id: 'corporate-inquiries', label: 'Corporate Inquiries', icon: Building2, href: '/super-admin/corporate-inquiries' },
    { id: 'referrals', label: 'Referrals', icon: Gift, href: '/super-admin/referrals' },
    { id: 'settings', label: 'System Settings', icon: Settings, href: '/super-admin/settings' },
    { id: 'failed-orders', label: 'Failed Orders', icon: AlertTriangle, href: '/super-admin/failed-orders' },
    { id: 'audit', label: 'Audit Logs', icon: FileText, href: '/super-admin/audit-logs' },
];

export default function SuperAdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const { logout, isInitialized } = useAuth();
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [adminName, setAdminName] = useState<string>('Admin');

    // Auth guard - check if user is SUPER_ADMIN
    useEffect(() => {
        if (!isInitialized) return;

        const checkAuth = async () => {
            try {
                // Check admin access by calling health endpoint
                const res = await api.get('/admin/health');
                console.log('[Admin] Health check response:', res.status);

                const data = res.data;
                setAdminName(data.admin || 'Admin');
                setIsLoading(false);
            } catch (error: any) {
                console.error('Admin auth error:', error);
                if (error.response && error.response.status !== 401) {
                    toast.error(`Admin access denied: ${error.response.data?.error || 'Not authorized'}. Please login as SUPER_ADMIN.`);
                }
                router.push('/');
            }
        };

        checkAuth();
    }, [router, isInitialized]);

    // Close mobile menu on route change
    useEffect(() => {
        setMobileMenuOpen(false);
    }, [pathname]);

    const handleLogout = () => {
        logout();
        router.push('/');
    };

    // Get active nav item from pathname
    const getActiveItem = () => {
        const item = navItems.find((item) => pathname.startsWith(item.href));
        return item?.id || 'dashboard';
    };

    if (isLoading) {
        return (
            <div className="flex h-screen items-center justify-center bg-[#F4F0FA]">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="h-8 w-8 animate-spin text-[#4b2192]" />
                    <p className="text-gray-600">Verifying admin access...</p>
                </div>
            </div>
        );
    }

    const SidebarContent = ({ onItemClick }: { onItemClick?: () => void }) => (
        <>
            {/* Logo Area */}
            <div className="p-6 border-b border-white/10">
                <div className="flex items-center justify-between">
                    <DocnowLogo
                        href="/super-admin/dashboard"
                        width={148}
                        height={36}
                        panel
                        imageClassName="max-h-9 w-auto"
                        subtitle="Super Admin"
                        subtitleClassName="text-white/70"
                    />
                    {/* Close button for mobile, collapse toggle for desktop */}
                    <button
                        onClick={() => {
                            if (onItemClick) {
                                onItemClick();
                            } else {
                                setSidebarCollapsed(!sidebarCollapsed);
                            }
                        }}
                        className="p-2 rounded-lg hover:bg-white/10 transition-colors lg:block"
                        aria-label={onItemClick ? 'Close menu' : sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    >
                        {onItemClick ? (
                            <X size={20} />
                        ) : sidebarCollapsed ? (
                            <ChevronRight size={20} />
                        ) : (
                            <ChevronLeft size={20} />
                        )}
                    </button>
                </div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
                {navItems.map((item) => {
                    const isActive = getActiveItem() === item.id;
                    const Icon = item.icon;

                    return (
                        <Link
                            key={item.id}
                            href={item.href}
                            onClick={onItemClick}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${isActive
                                ? 'bg-white/20 text-white'
                                : 'text-white/70 hover:bg-white/10 hover:text-white'
                                }`}
                        >
                            <span className="flex-shrink-0">
                                <Icon size={20} />
                            </span>
                            <span className="text-sm">{item.label}</span>
                        </Link>
                    );
                })}
            </nav>

            {/* Mode Switcher */}
            <div className="px-4 pb-2 border-b border-white/10 mb-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-2">Switch Mode</p>
                <Link
                    href="/"
                    onClick={onItemClick}
                    className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-colors text-sm"
                >
                    <Home size={18} />
                    <span>Exit to Site</span>
                </Link>
                <Link
                    href="/manager"
                    onClick={onItemClick}
                    className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-colors text-sm"
                >
                    <Shield size={18} />
                    <span>Manager Panel</span>
                </Link>
            </div>

            {/* Admin Info & Logout */}
            <div className="p-4">
                <div className="mb-3 px-4">
                    <p className="text-sm font-medium">{adminName}</p>
                    <p className="text-xs text-white/50">Super Admin</p>
                </div>
                <button
                    onClick={() => {
                        onItemClick?.();
                        handleLogout();
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-colors"
                >
                    <LogOut size={20} />
                    <span className="text-sm">Logout</span>
                </button>
            </div>
        </>
    );

    return (
        <div className="flex h-screen bg-[#F4F0FA]">
            {/* Desktop Sidebar */}
            <aside
                className={`hidden lg:flex flex-col bg-[#4b2192] text-white transition-all duration-300 ${sidebarCollapsed ? 'w-20' : 'w-64'
                    }`}
            >
                {/* Desktop: collapsed sidebar shows only icons */}
                {sidebarCollapsed ? (
                    <>
                        <div className="p-4 border-b border-white/10 flex justify-center">
                            <button
                                onClick={() => setSidebarCollapsed(false)}
                                className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                                aria-label="Expand sidebar"
                            >
                                <ChevronRight size={20} />
                            </button>
                        </div>
                        <nav className="flex-1 p-2 space-y-2 overflow-y-auto">
                            {navItems.map((item) => {
                                const isActive = getActiveItem() === item.id;
                                const Icon = item.icon;
                                return (
                                    <Link
                                        key={item.id}
                                        href={item.href}
                                        className={`flex items-center justify-center p-3 rounded-lg transition-all ${isActive
                                            ? 'bg-white/20 text-white'
                                            : 'text-white/70 hover:bg-white/10 hover:text-white'
                                            }`}
                                        title={item.label}
                                    >
                                        <Icon size={20} />
                                    </Link>
                                );
                            })}
                        </nav>
                        <div className="p-2 border-t border-white/10 space-y-1">
                            <Link
                                href="/"
                                className="w-full flex items-center justify-center p-3 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-colors"
                                title="Exit to Site"
                            >
                                <Home size={20} />
                            </Link>
                            <Link
                                href="/manager"
                                className="w-full flex items-center justify-center p-3 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-colors"
                                title="Manager Panel"
                            >
                                <Shield size={20} />
                            </Link>
                            <button
                                onClick={handleLogout}
                                className="w-full flex items-center justify-center p-3 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-colors"
                                title="Logout"
                            >
                                <LogOut size={20} />
                            </button>
                        </div>
                    </>
                ) : (
                    <SidebarContent />
                )}
            </aside>

            {/* Mobile Overlay */}
            {mobileMenuOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 lg:hidden"
                    onClick={() => setMobileMenuOpen(false)}
                />
            )}

            {/* Mobile Sidebar */}
            <aside
                className={`fixed inset-y-0 left-0 z-50 w-64 bg-[#4b2192] text-white transform transition-transform duration-300 lg:hidden flex flex-col ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
                    }`}
            >
                <SidebarContent onItemClick={() => setMobileMenuOpen(false)} />
            </aside>

            {/* Main Content */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Mobile Header */}
                <header className="h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-3 lg:hidden flex-shrink-0 shadow-sm">
                    <button
                        onClick={() => setMobileMenuOpen(true)}
                        className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
                        aria-label="Open navigation"
                    >
                        <Menu size={22} />
                    </button>
                    <DocnowLogo href="/super-admin/dashboard" width={132} height={32} imageClassName="max-h-8 w-auto" />
                    <span className="text-xs text-gray-400 font-medium">Admin</span>
                </header>

                {/* Page Content */}
                <main className="flex-1 overflow-auto">
                    <div className="p-4 sm:p-6 lg:p-8">{children}</div>
                </main>
            </div>
        </div>
    );
}
