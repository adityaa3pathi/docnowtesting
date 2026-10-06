'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { PageHeader, inputCls } from '@/components/admin/consult/shared';
import { Badge } from '@/components/consult/Badge';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/consult/States';
import { useApi } from '@/hooks/useApi';
import { admin } from '@/lib/consult/api';
import { formatRupees } from '@/lib/consult/format';
import { doctorStatusInfo } from '@/lib/consult/status';

const FILTERS = [
    { value: '', label: 'All' },
    { value: 'PENDING', label: 'Waiting for approval' },
    { value: 'APPROVED', label: 'Approved' },
    { value: 'REJECTED', label: 'Not approved' },
    { value: 'SUSPENDED', label: 'Suspended' },
];

export default function ConsultDoctorsPage() {
    const [status, setStatus] = useState('');
    const { data, error, loading, refetch } = useApi(() => admin.doctors(status || undefined), [status]);

    return (
        <div className="mx-auto max-w-[1100px]">
            <PageHeader
                title="Consult doctors"
                subtitle="Approve doctors and set their fee."
                action={
                    <Link href="/super-admin/consult-doctors/new" className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary/90">
                        <Plus size={16} aria-hidden /> Add doctor
                    </Link>
                }
            />
            <div className="mb-4 max-w-xs">
                <label htmlFor="status" className="mb-1 block text-sm font-medium text-gray-700">Show</label>
                <select id="status" value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
                    {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
            </div>
            {loading ? <LoadingBlock label="Loading doctors" />
                : error ? <ErrorState message={error} onRetry={refetch} />
                : !data || data.length === 0 ? <EmptyState title="No doctors here" body="Doctors who match this filter will show up here." />
                : (
                    <ul className="space-y-3">
                        {data.map((d) => {
                            const info = doctorStatusInfo(d.status);
                            return (
                                <li key={d.id}>
                                    <Link href={`/super-admin/consult-doctors/${d.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm hover:border-primary/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                                        <div className="min-w-0">
                                            <p className="font-semibold text-gray-900">{d.displayName}</p>
                                            <p className="text-sm text-gray-500">{d.specialty.name} · {d.consultationFee > 0 ? formatRupees(d.consultationFee) : 'No fee set'}</p>
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
