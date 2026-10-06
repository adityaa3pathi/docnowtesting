'use client';
import { usePathname } from 'next/navigation';
import { Header } from './Header';

export function GlobalHeader() {
    const pathname = usePathname();
    const isAdminRoute =
        pathname.startsWith('/super-admin') || pathname.startsWith('/manager') || pathname.startsWith('/doctor');
    if (isAdminRoute) return null;
    return <Header />;
}
