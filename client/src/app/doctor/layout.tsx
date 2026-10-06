'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft, CalendarOff, Clock, LayoutDashboard } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { DocnowLogo } from '@/components/DocnowLogo';
import { ErrorState, LoadingBlock } from '@/components/consult/States';
import { ApplicationForm } from '@/components/doctor/ApplicationForm';
import { DoctorContext } from '@/components/doctor/DoctorContext';
import { PendingScreen, RejectedNotice, SuspendedScreen } from '@/components/doctor/StatusScreens';
import { doctor as doctorApi, errorMessage, errorStatus } from '@/lib/consult/api';
import type { DoctorMe } from '@/lib/consult/types';
import { cn } from '@/lib/utils';

const TOOLS = [
    { href: '/doctor', label: 'Home', icon: LayoutDashboard },
    { href: '/doctor/availability', label: 'Hours', icon: Clock },
    { href: '/doctor/leave', label: 'Leave', icon: CalendarOff },
];

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'none' } | { state: 'ready'; doctor: DoctorMe };

export default function DoctorLayout({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const { user, isInitialized } = useAuth();
    const [load, setLoad] = useState<Load>({ state: 'loading' });

    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        if (!isInitialized) return;
        if (!user) {
            router.replace('/?login=true&redirect=/doctor');
            return;
        }
        let alive = true;
        doctorApi.me().then(
            (me) => alive && setLoad({ state: 'ready', doctor: me }),
            (e) => {
                if (!alive) return;
                const status = errorStatus(e);
                // A 404 means no application yet; 401 means the session ended.
                if (status === 404) setLoad({ state: 'none' });
                else if (status === 401) router.replace('/?login=true&redirect=/doctor');
                else setLoad({ state: 'error', message: errorMessage(e) });
            },
        );
        return () => {
            alive = false;
        };
    }, [isInitialized, user, router, attempt]);

    const retry = () => {
        setLoad({ state: 'loading' });
        setAttempt((n) => n + 1);
    };

    const doctor = load.state === 'ready' ? load.doctor : null;
    const approved = doctor?.status === 'APPROVED';
    const setDoctor = (next: DoctorMe) => setLoad({ state: 'ready', doctor: next });

    let body: React.ReactNode;
    if (!isInitialized || !user || load.state === 'loading') body = <LoadingBlock label="Loading your doctor page" />;
    else if (load.state === 'error') body = <ErrorState message={load.message} onRetry={retry} />;
    else if (load.state === 'none') {
        body = (
            <>
                <div className="mb-4">
                    <h1 className="text-2xl font-bold text-foreground">Join as a doctor</h1>
                    <p className="text-sm text-muted-foreground">Tell us about yourself. We will check your details before patients can book you.</p>
                </div>
                <ApplicationForm onDone={setDoctor} />
            </>
        );
    } else if (doctor && approved) body = <DoctorContext.Provider value={{ doctor, setDoctor }}>{children}</DoctorContext.Provider>;
    else if (doctor?.status === 'PENDING') body = <PendingScreen doctor={doctor} />;
    else if (doctor?.status === 'SUSPENDED') body = <SuspendedScreen doctor={doctor} />;
    else if (doctor) {
        body = (
            <>
                <RejectedNotice doctor={doctor} />
                <ApplicationForm existing={doctor} onDone={setDoctor} />
            </>
        );
    }

    const isActive = (href: string) => (href === '/doctor' ? pathname === href : pathname.startsWith(href));
    const itemClass = (active: boolean) => cn(
        'flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-colors',
        active ? 'bg-primary text-white' : 'text-gray-700 hover:bg-primary/5 hover:text-primary',
    );

    return (
        <div className="min-h-screen bg-[#F4F0FA] md:flex">
            <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-white p-4 md:flex">
                <div className="mb-6 px-2"><DocnowLogo href="/" width={132} height={32} imageClassName="max-h-8 w-auto" /></div>
                <nav aria-label="Doctor menu" className="flex flex-1 flex-col gap-1">
                    {approved && TOOLS.map(({ href, label, icon: Icon }) => (
                        <Link key={href} href={href} aria-current={isActive(href) ? 'page' : undefined} className={itemClass(isActive(href))}>
                            <Icon className="h-5 w-5" aria-hidden /> {label}
                        </Link>
                    ))}
                    <Link href="/" className={cn(itemClass(false), 'mt-auto')}><ArrowLeft className="h-5 w-5" aria-hidden /> Back to site</Link>
                </nav>
            </aside>

            <div className="min-w-0 flex-1">
                <header className="flex h-14 items-center border-b border-border bg-white px-4 md:hidden">
                    <DocnowLogo href="/" width={116} height={28} imageClassName="max-h-7 w-auto" />
                </header>
                <main className="mx-auto w-full max-w-3xl px-4 py-6 pb-28 md:px-8 md:pb-10">{body}</main>
            </div>

            <nav aria-label="Doctor menu" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
                {approved && TOOLS.map(({ href, label, icon: Icon }) => (
                    <Link key={href} href={href} aria-current={isActive(href) ? 'page' : undefined}
                        className={cn('flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-semibold', isActive(href) ? 'text-primary' : 'text-gray-600')}>
                        <Icon className="h-5 w-5" aria-hidden /> {label}
                    </Link>
                ))}
                <Link href="/" className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-semibold text-gray-600">
                    <ArrowLeft className="h-5 w-5" aria-hidden /> Back to site
                </Link>
            </nav>
        </div>
    );
}
