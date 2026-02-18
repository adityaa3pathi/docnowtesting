'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
    LayoutDashboard,
    Package,
    FolderTree,
    Link as LinkIcon,
    ShoppingCart,
    Settings,
    Menu,
    X,
    LogOut,
    Loader2,
    Activity,
} from 'lucide-react';

const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/manager/dashboard' },
    { id: 'catalog', label: 'Catalog', icon: Package, href: '/manager/catalog' },
    { id: 'categories', label: 'Categories', icon: FolderTree, href: '/manager/categories' },
    { id: 'payment-links', label: 'Payment Links', icon: LinkIcon, href: '/manager/payment-links' },
    { id: 'orders', label: 'Orders', icon: ShoppingCart, href: '/manager/orders', badge: 'Read-only' },
    { id: 'settings', label: 'Settings', icon: Settings, href: '/manager/settings' },
];

export default function ManagerLayout({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [managerName, setManagerName] = useState('Manager');

    // Auth guard — check MANAGER or SUPER_ADMIN role
    useEffect(() => {
        const checkAuth = async () => {
            try {
                const token = localStorage.getItem('docnow_auth_token');
                if (!token) { router.push('/'); return; }

                const res = await fetch('/api/manager/health', {
                    headers: { Authorization: `Bearer ${token}` },
                });

                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    alert(`Manager access denied: ${err.error || 'Not authorized'}`);
                    router.push('/');
                    return;
                }

                const data = await res.json();
                setManagerName(data.manager || 'Manager');
                setIsLoading(false);
            } catch {
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

    const getActiveItem = () => {
        const item = navItems.find((n) => pathname.startsWith(n.href));
        return item?.id || 'dashboard';
    };

    if (isLoading) {
        return (
            <div className="flex h-screen items-center justify-center" style={{ backgroundColor: '#F8F7FC' }}>
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="h-8 w-8 animate-spin" style={{ color: '#4b2192' }} />
                    <p className="text-gray-600">Verifying manager access...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-screen overflow-hidden" style={{ backgroundColor: '#F8F7FC' }}>
            {/* Sidebar — Desktop */}
            <aside className="hidden lg:flex lg:flex-col w-64 flex-shrink-0" style={{ backgroundColor: '#4b2192' }}>
                {/* Logo */}
                <div className="h-16 flex items-center px-6 border-b border-white/10">
                    <div className="flex items-center gap-2">
                        <Activity className="h-7 w-7 text-white" />
                        <div>
                            <span className="font-semibold text-white text-lg">DOCNOW</span>
                            <p className="text-xs text-white/60 -mt-0.5">Manager Panel</p>
                        </div>
                    </div>
                </div>

                {/* Navigation */}
                <nav className="flex-1 px-3 py-4 overflow-y-auto">
                    <ul className="space-y-1">
                        {navItems.map((item) => {
                            const isActive = getActiveItem() === item.id;
                            const Icon = item.icon;
                            return (
                                <li key={item.id}>
                                    <Link
                                        href={item.href}
                                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${isActive
                                                ? 'bg-white/20 text-white shadow-lg'
                                                : 'text-white/70 hover:bg-white/10 hover:text-white'
                                            }`}
                                    >
                                        <Icon className="h-5 w-5 flex-shrink-0" />
                                        <span className="flex-1 text-sm">{item.label}</span>
                                        {item.badge && (
                                            <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded">
                                                {item.badge}
                                            </span>
                                        )}
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                </nav>

                {/* User Info + Logout */}
                <div className="p-4 border-t border-white/10">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="h-9 w-9 rounded-full bg-white/20 flex items-center justify-center text-white text-sm font-medium">
                            {managerName.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm text-white truncate">{managerName}</p>
                            <p className="text-xs text-white/50 truncate">Manager</p>
                        </div>
                    </div>
                    <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-colors text-sm"
                    >
                        <LogOut className="h-5 w-5" />
                        <span>Logout</span>
                    </button>
                </div>
            </aside>

            {/* Mobile overlay */}
            {mobileMenuOpen && (
                <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setMobileMenuOpen(false)} />
            )}

            {/* Sidebar — Mobile */}
            <aside
                className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 lg:hidden ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
                    }`}
                style={{ backgroundColor: '#4b2192' }}
            >
                <div className="h-16 flex items-center justify-between px-6 border-b border-white/10">
                    <div className="flex items-center gap-2">
                        <Activity className="h-7 w-7 text-white" />
                        <span className="font-semibold text-white">DOCNOW</span>
                    </div>
                    <button onClick={() => setMobileMenuOpen(false)} className="text-white p-1 rounded hover:bg-white/10">
                        <X className="h-6 w-6" />
                    </button>
                </div>
                <nav className="flex-1 px-3 py-4 overflow-y-auto">
                    <ul className="space-y-1">
                        {navItems.map((item) => {
                            const isActive = getActiveItem() === item.id;
                            const Icon = item.icon;
                            return (
                                <li key={item.id}>
                                    <Link
                                        href={item.href}
                                        onClick={() => setMobileMenuOpen(false)}
                                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${isActive
                                                ? 'bg-white/20 text-white shadow-lg'
                                                : 'text-white/70 hover:bg-white/10 hover:text-white'
                                            }`}
                                    >
                                        <Icon className="h-5 w-5 flex-shrink-0" />
                                        <span className="flex-1 text-sm">{item.label}</span>
                                        {item.badge && (
                                            <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded">{item.badge}</span>
                                        )}
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                </nav>
            </aside>

            {/* Main Content */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Top header */}
                <header className="h-16 bg-white border-b border-gray-200 flex-shrink-0 px-4 sm:px-6 lg:px-8 flex items-center justify-between">
                    <button onClick={() => setMobileMenuOpen(true)} className="lg:hidden p-2 hover:bg-gray-100 rounded-lg">
                        <Menu className="h-6 w-6" />
                    </button>
                    <div className="hidden lg:block" />
                    <div className="flex items-center gap-3">
                        <div
                            className="h-9 w-9 rounded-full flex items-center justify-center text-white text-sm font-medium"
                            style={{ backgroundColor: '#4b2192' }}
                        >
                            {managerName.slice(0, 2).toUpperCase()}
                        </div>
                    </div>
                </header>

                {/* Page content */}
                <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
                    {children}
                </main>
            </div>
        </div>
    );
}
