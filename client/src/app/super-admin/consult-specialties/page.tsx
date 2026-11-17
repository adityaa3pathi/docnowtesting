'use client';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui';
import { Field, PageHeader, inputCls } from '@/components/admin/consult/shared';
import { Badge } from '@/components/consult/Badge';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/consult/States';
import { useApi } from '@/hooks/useApi';
import { admin, errorMessage } from '@/lib/consult/api';
import type { Specialty } from '@/lib/consult/types';

export default function ConsultSpecialtiesPage() {
    const { data, error, loading, refetch } = useApi(() => admin.specialties(), []);
    const [name, setName] = useState('');
    const [adding, setAdding] = useState(false);
    const [addError, setAddError] = useState<string | null>(null);
    const [editId, setEditId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [rowError, setRowError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    async function add(e: React.FormEvent) {
        e.preventDefault();
        if (name.trim().length < 2) return setAddError('Name must be at least 2 characters.');
        setAdding(true);
        setAddError(null);
        try {
            await admin.createSpecialty({ name: name.trim() });
            setName('');
            toast.success('Specialty added');
            await refetch();
        } catch (err) {
            setAddError(errorMessage(err));
        } finally {
            setAdding(false);
        }
    }

    async function change(s: Specialty, body: { name?: string; isActive?: boolean }) {
        setBusyId(s.id);
        setRowError(null);
        try {
            await admin.updateSpecialty(s.id, body);
            setEditId(null);
            await refetch();
        } catch (err) {
            setRowError(errorMessage(err));
        } finally {
            setBusyId(null);
        }
    }

    return (
        <div className="mx-auto max-w-[800px]">
            <PageHeader title="Specialties" subtitle="Patients pick a specialty before choosing a doctor." />
            <form onSubmit={add} className="mb-6 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm" noValidate>
                <Field label="New specialty" htmlFor="new-specialty" error={addError ?? undefined}>
                    <div className="flex gap-2">
                        <input id="new-specialty" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
                        <Button type="submit" disabled={adding}>{adding ? 'Adding...' : 'Add'}</Button>
                    </div>
                </Field>
            </form>
            {rowError && <p role="alert" className="mb-3 text-sm font-semibold text-red-600">{rowError}</p>}
            {loading && !data ? <LoadingBlock label="Loading specialties" />
                : error ? <ErrorState message={error} onRetry={refetch} />
                : !data || data.length === 0 ? <EmptyState title="No specialties yet" body="Add the first one above." />
                : (
                    <ul className="space-y-3">
                        {data.map((s) => (
                            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                                {editId === s.id ? (
                                    <div className="flex min-w-0 flex-1 gap-2">
                                        <input aria-label={`New name for ${s.name}`} value={editName} onChange={(e) => setEditName(e.target.value)} className={inputCls} />
                                        <Button size="sm" disabled={editName.trim().length < 2 || busyId === s.id} onClick={() => change(s, { name: editName.trim() })}>Save</Button>
                                        <Button size="sm" variant="outline" onClick={() => setEditId(null)}>Cancel</Button>
                                    </div>
                                ) : (
                                    <>
                                        <div className="flex items-center gap-2">
                                            <span className="font-semibold text-gray-900">{s.name}</span>
                                            <Badge tone={s.isActive ? 'success' : 'muted'}>{s.isActive ? 'Active' : 'Hidden'}</Badge>
                                        </div>
                                        <div className="flex gap-2">
                                            <Button size="sm" variant="outline" onClick={() => { setEditId(s.id); setEditName(s.name); }}>Rename</Button>
                                            <Button size="sm" variant="outline" disabled={busyId === s.id} onClick={() => change(s, { isActive: !s.isActive })}>
                                                {s.isActive ? 'Hide' : 'Show'}
                                            </Button>
                                        </div>
                                    </>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
        </div>
    );
}
