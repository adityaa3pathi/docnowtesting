'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
    LayoutDashboard,
    Users,
    ShoppingCart,
    Wallet,
    Gift,
    Settings,
    FileText,
    ChevronLeft,
    ChevronRight,
    LogOut,
    Loader2,
    Ticket,
} from 'lucide-react';

// Navigation items matching the design
const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/super-admin/dashboard' },
    { id: 'users', label: 'Users', icon: Users, href: '/super-admin/users' },
    { id: 'orders', label: 'Orders', icon: ShoppingCart, href: '/super-admin/orders' },
    { id: 'wallets', label: 'Wallets', icon: Wallet, href: '/super-admin/wallets' },
    { id: 'promos', label: 'Promo Codes', icon: Ticket, href: '/super-admin/promos' },
    { id: 'referrals', label: 'Referrals', icon: Gift, href: '/super-admin/referrals' },
    { id: 'settings', label: 'System Settings', icon: Settings, href: '/super-admin/settings' },
    { id: 'audit', label: 'Audit Logs', icon: FileText, href: '/super-admin/audit-logs' },
];

export default function SuperAdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [adminName, setAdminName] = useState<string>('Admin');

    // Auth guard - check if user is SUPER_ADMIN
    useEffect(() => {
        const checkAuth = async () => {
            try {
                const token = localStorage.getItem('docnow_auth_token');
                if (!token) {
                    console.log('[Admin] No token found, redirecting to home');
                    router.push('/');
                    return;
                }

                // Check admin access by calling health endpoint
                const res = await fetch('/api/admin/health', {
                    headers: { Authorization: `Bearer ${token}` },
                });

                console.log('[Admin] Health check response:', res.status);

                if (!res.ok) {
                    const errorData = await res.json().catch(() => ({}));
                    console.error('[Admin] Auth failed:', res.status, errorData);
                    alert(`Admin access denied: ${errorData.error || 'Not authorized'}. Please login as SUPER_ADMIN.`);
                    router.push('/');
                    return;
                }

                const data = await res.json();
                setAdminName(data.admin || 'Admin');
                setIsLoading(false);
            } catch (error) {
                console.error('Admin auth error:', error);
                router.push('/');
            }
        };

        checkAuth();
    }, [router]);

    const handleLogout = () => {
        localStorage.removeItem('docnow_auth_token');
        localStorage.removeItem('docnow_user');
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

    return (
        <div className="flex h-screen bg-[#F4F0FA]">
            {/* Sidebar */}
            <aside
                className={`bg-[#4b2192] text-white transition-all duration-300 flex flex-col ${sidebarCollapsed ? 'w-20' : 'w-64'
                    }`}
            >
                {/* Logo Area */}
                <div className="p-6 border-b border-white/10">
                    <div className="flex items-center justify-between">
                        {!sidebarCollapsed && (
                            <div>
                                <h1 className="text-xl font-semibold">DOCNOW</h1>
                                <p className="text-xs text-white/70 mt-1">Super Admin</p>
                            </div>
                        )}
                        <button
                            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                            className="p-2 rounded-lg hover:bg-white/10 transition-colors ml-auto"
                            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                        >
                            {sidebarCollapsed ? (
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
                                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${isActive
                                    ? 'bg-white/20 text-white'
                                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                                    }`}
                            >
                                <span className="flex-shrink-0">
                                    <Icon size={20} />
                                </span>
                                {!sidebarCollapsed && (
                                    <span className="text-sm">{item.label}</span>
                                )}
                            </Link>
                        );
                    })}
                </nav>

                {/* Admin Info & Logout */}
                <div className="p-4 border-t border-white/10">
                    {!sidebarCollapsed && (
                        <div className="mb-3 px-4">
                            <p className="text-sm font-medium">{adminName}</p>
                            <p className="text-xs text-white/50">Super Admin</p>
                        </div>
                    )}
                    <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-colors"
                    >
                        <LogOut size={20} />
                        {!sidebarCollapsed && <span className="text-sm">Logout</span>}
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-auto">
                <div className="p-8">{children}</div>
            </main>
        </div>
    );
}
