import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export const inputCls =
    'w-full rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

export function PageHeader({ title, subtitle, back, action }: { title: string; subtitle?: string; back?: { href: string; label: string }; action?: React.ReactNode }) {
    return (
        <div className="mb-6">
            {back && (
                <Link href={back.href} className="mb-3 inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700">
                    <ArrowLeft size={16} aria-hidden /> {back.label}
                </Link>
            )}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
                    {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
                </div>
                {action}
            </div>
        </div>
    );
}

export function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor: string; error?: string; hint?: string; children: React.ReactNode }) {
    return (
        <div>
            <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-gray-700">
                {label}
            </label>
            {children}
            {error ? (
                <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>
            ) : (
                hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>
            )}
        </div>
    );
}

export const SLOT_OPTIONS = [10, 15, 20, 30, 45, 60];
