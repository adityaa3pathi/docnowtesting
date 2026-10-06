'use client';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui';
import { Badge } from '@/components/consult/Badge';
import { ReasonDialog } from '@/components/consult/ReasonDialog';
import { ErrorState, LoadingBlock } from '@/components/consult/States';
import { useApi } from '@/hooks/useApi';
import { admin, errorMessage } from '@/lib/consult/api';
import { formatRupees } from '@/lib/consult/format';
import { doctorStatusInfo } from '@/lib/consult/status';
import { Field, SLOT_OPTIONS, inputCls } from './shared';

type Dialog = 'reject' | 'suspend' | null;

export function DoctorDetail({ id }: { id: string }) {
    const { data: doc, error, loading, refetch, setData } = useApi(() => admin.doctor(id), [id]);
    const [fee, setFee] = useState<string | null>(null);
    const [slot, setSlot] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);
    const [busy, setBusy] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [dialog, setDialog] = useState<Dialog>(null);

    if (loading && !doc) return <LoadingBlock label="Loading doctor" />;
    if (error && !doc) return <ErrorState message={error} onRetry={refetch} />;
    if (!doc) return null;

    const feeText = fee ?? String(doc.consultationFee || '');
    const slotValue = slot ?? doc.slotMinutes;
    const feeNum = Number(feeText);
    const feeValid = feeText !== '' && Number.isFinite(feeNum) && feeNum > 0;
    const dirty = feeNum !== doc.consultationFee || slotValue !== doc.slotMinutes;
    const info = doctorStatusInfo(doc.status);
    const hasFee = doc.consultationFee > 0 && !dirty;

    async function save() {
        setSaving(true);
        setFormError(null);
        try {
            setData(await admin.updateDoctor(id, { consultationFee: feeNum, slotMinutes: slotValue }));
            setFee(null);
            setSlot(null);
            toast.success('Saved');
        } catch (e) {
            setFormError(errorMessage(e));
        } finally {
            setSaving(false);
        }
    }

    async function approve() {
        setBusy(true);
        setFormError(null);
        try {
            setData(await admin.approve(id));
            toast.success('Doctor approved');
        } catch (e) {
            setFormError(errorMessage(e));
        } finally {
            setBusy(false);
        }
    }

    const canApprove = doc.status !== 'APPROVED' && hasFee;

    return (
        <div className="space-y-6">
            <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-8">
                <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-xl font-bold text-gray-900">{doc.displayName}</h2>
                    <Badge tone={info.tone}>{info.label}</Badge>
                </div>
                <p className="mt-1 text-sm text-gray-500">{doc.specialty.name} · {doc.qualification} · {doc.experienceYears} years</p>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    <div><dt className="text-gray-500">Registration</dt><dd className="font-medium">{doc.registrationNumber} ({doc.registrationCouncil})</dd></div>
                    <div><dt className="text-gray-500">Mobile</dt><dd className="font-medium">{doc.user?.mobile ?? 'Not shown'}</dd></div>
                    <div><dt className="text-gray-500">Languages</dt><dd className="font-medium">{doc.languages.join(', ')}</dd></div>
                    <div><dt className="text-gray-500">Current fee</dt><dd className="font-medium">{doc.consultationFee > 0 ? formatRupees(doc.consultationFee) : 'Not set'}</dd></div>
                </dl>
                {doc.statusReason && (
                    <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><span className="font-semibold">Reason: </span>{doc.statusReason}</p>
                )}
            </section>

            <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-8" aria-labelledby="fee-h">
                <h2 id="fee-h" className="mb-4 text-lg font-semibold text-gray-900">Fee and slot length</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Consultation fee (rupees)" htmlFor="fee" error={fee !== null && !feeValid ? 'Fee must be more than zero' : undefined}>
                        <input id="fee" type="number" min={1} step="any" value={feeText} onChange={(e) => setFee(e.target.value)} className={inputCls} />
                    </Field>
                    <Field label="Slot length" htmlFor="slot">
                        <select id="slot" value={slotValue} onChange={(e) => setSlot(Number(e.target.value))} className={inputCls}>
                            {SLOT_OPTIONS.map((m) => <option key={m} value={m}>{m} minutes</option>)}
                        </select>
                    </Field>
                </div>
                <div className="mt-4"><Button onClick={save} disabled={!dirty || !feeValid || saving}>{saving ? 'Saving...' : 'Save changes'}</Button></div>
            </section>

            <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-8" aria-labelledby="status-h">
                <h2 id="status-h" className="mb-3 text-lg font-semibold text-gray-900">Approval</h2>
                {!hasFee && doc.status !== 'APPROVED' && (
                    <p className="mb-3 text-sm text-gray-600">Set and save a fee above zero before approving.</p>
                )}
                <div className="flex flex-wrap gap-2">
                    {doc.status !== 'APPROVED' && <Button onClick={approve} disabled={!canApprove || busy}>Approve</Button>}
                    {(doc.status === 'PENDING') && <Button variant="outline" onClick={() => setDialog('reject')} disabled={busy}>Reject</Button>}
                    {doc.status === 'APPROVED' && <Button variant="outline" onClick={() => setDialog('suspend')} disabled={busy}>Suspend</Button>}
                </div>
                {formError && <p role="alert" className="mt-3 text-sm font-semibold text-red-600">{formError}</p>}
            </section>

            <ReasonDialog
                open={dialog === 'reject'} title="Reject this doctor" description="The doctor will see this reason." confirmLabel="Reject" destructive
                onClose={() => setDialog(null)} onConfirm={async (r) => { setData(await admin.reject(id, r)); toast.success('Doctor rejected'); }}
            />
            <ReasonDialog
                open={dialog === 'suspend'} title="Suspend this doctor" description="Patients will no longer be able to book them." confirmLabel="Suspend" destructive
                onClose={() => setDialog(null)} onConfirm={async (r) => { setData(await admin.suspend(id, r)); toast.success('Doctor suspended'); }}
            />
        </div>
    );
}
