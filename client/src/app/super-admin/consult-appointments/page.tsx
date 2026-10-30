'use client';
import { useState } from 'react';
import Link from 'next/link';
import { PageHeader, inputCls } from '@/components/admin/consult/shared';
import { Badge } from '@/components/consult/Badge';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/consult/States';
import { useApi } from '@/hooks/useApi';
import { admin } from '@/lib/consult/api';
import { statusInfo } from '@/lib/consult/status';
import { formatIstTime, istDayKey, serverNow } from '@/lib/consult/time';
import type { ConsultationStatus } from '@/lib/consult/types';

const STATUSES: ConsultationStatus[] = [
    'CONFIRMED', 'RESCHEDULED', 'WAITING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED',
    'NO_SHOW_PATIENT', 'NO_SHOW_DOCTOR', 'REFUNDED', 'PENDING_PAYMENT', 'EXPIRED',
];

export default function ConsultAppointmentsPage() {
    const [date, setDate] = useState(() => istDayKey(new Date(serverNow()).toISOString()));
    const [status, setStatus] = useState('');
    const { data, error, loading, refetch } = useApi(() => admin.appointments({ date, status }), [date, status]);

    return (
        <div className="mx-auto max-w-[1100px]">
            <PageHeader title="Consult appointments" subtitle="Who is booked each day, and whether calls happened. Indian time." />
            <div className="mb-4 flex flex-wrap gap-3">
                <div className="w-48">
                    <label htmlFor="date" className="mb-1 block text-sm font-medium text-gray-700">Day</label>
                    <input id="date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={inputCls} />
                </div>
                <div className="w-60">
                    <label htmlFor="status" className="mb-1 block text-sm font-medium text-gray-700">Status</label>
                    <select id="status" value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
                        <option value="">All booked</option>
                        {STATUSES.map((s) => <option key={s} value={s}>{statusInfo(s).label}</option>)}
                    </select>
                </div>
            </div>
            {loading ? <LoadingBlock label="Loading appointments" />
                : error ? <ErrorState message={error} onRetry={refetch} />
                : !data || data.items.length === 0 ? <EmptyState title="No appointments" body="Nothing matches this day and status." />
                : (
                    <ul className="space-y-3">
                        {data.items.map((a) => {
                            const info = statusInfo(a.status);
                            return (
                                <li key={a.id}>
                                    <Link href={`/super-admin/consult-appointments/${a.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm hover:border-primary/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                                        <div className="min-w-0">
                                            <p className="font-semibold text-gray-900">{formatIstTime(a.startsAt)} to {formatIstTime(a.endsAt)} · {a.doctor.displayName}</p>
                                            <p className="text-sm text-gray-500">
                                                {a.doctor.specialty.name} · Patient {a.patient.name} · {a.type.toLowerCase()}
                                                {a.prescriptionIssuedAt ? ' · Prescription issued' : ''}
                                            </p>
                                        </div>
                                        <Badge tone={info.tone}>{info.label}</Badge>
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                )}
        </div>
    );
}
