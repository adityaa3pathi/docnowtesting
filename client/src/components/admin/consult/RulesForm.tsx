'use client';
import { useEffect, useRef, useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorState, LoadingBlock } from '@/components/consult/States';
import { Badge } from '@/components/consult/Badge';
import { useApi } from '@/hooks/useApi';
import { admin, errorMessage } from '@/lib/consult/api';
import { formatIstDateTime } from '@/lib/consult/time';
import { CEILINGS, sortTiers, validateRules, versionChanged } from '@/lib/consult/rules';
import type { ConsultRules, PolicyResponse } from '@/lib/consult/types';
import { RefundTiersEditor } from './RefundTiersEditor';
import { Field, inputCls } from './shared';

const NUMBER_FIELDS = [
    { name: 'holdMinutes', label: 'Slot hold time (minutes)', range: CEILINGS.holdMinutes, hint: 'How long a slot is held while the patient pays.' },
    { name: 'minLeadMinutes', label: 'Booking lead time (minutes)', range: CEILINGS.minLeadMinutes, hint: 'How soon before a visit booking stops.' },
    { name: 'doctorNoShowWaitMinutes', label: 'Wait for doctor (minutes)', range: CEILINGS.waitMinutes, hint: 'After this, a missing doctor means a full refund.' },
    { name: 'patientNoShowWaitMinutes', label: 'Wait for patient (minutes)', range: CEILINGS.waitMinutes, hint: 'After this, a missing patient is marked as no-show.' },
    { name: 'platformFeeBps', label: 'Platform fee (basis points)', range: CEILINGS.platformFeeBps, hint: '100 basis points is 1 percent. At most 5000 (50 percent).' },
    { name: 'uploadLimitMb', label: 'Upload limit (MB)', range: CEILINGS.uploadLimitMb, hint: 'Largest file a patient can attach.' },
] as const;

export function RulesForm() {
    const policy = useApi(() => admin.policy(), []);
    if (policy.loading && !policy.data) return <LoadingBlock label="Loading rules" />;
    if (policy.error && !policy.data) return <ErrorState message={policy.error} onRetry={policy.refetch} />;
    if (!policy.data) return null;
    return <Loaded policy={policy.data} reload={policy.refetch} />;
}

function Loaded({ policy, reload }: { policy: PolicyResponse; reload: () => Promise<void> }) {
    const loadedVersion = useRef(policy.active.version);
    const { register, control, reset, getValues, setValue } = useForm<ConsultRules>({ defaultValues: policy.active.rules });
    const { fields, append, remove } = useFieldArray({ control, name: 'refundTiers', keyName: 'key' });
    const values = useWatch({ control });
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [newer, setNewer] = useState<PolicyResponse | null>(null);

    // Re-seed only when a fresh policy is loaded after a save or "use latest".
    useEffect(() => {
        loadedVersion.current = policy.active.version;
        reset(policy.active.rules);
    }, [policy, reset]);

    const problems = validateRules({ ...(values as ConsultRules), doctorNoShowOutcome: 'FULL_REFUND', refundTiers: (values.refundTiers ?? []) as ConsultRules['refundTiers'] });
    const reasonOk = reason.trim().length >= 3;

    async function write() {
        setSaving(true);
        setFormError(null);
        try {
            await admin.savePolicy({ ...getValues(), doctorNoShowOutcome: 'FULL_REFUND' }, reason.trim());
            toast.success('Rules saved');
            setReason('');
            setNewer(null);
            await reload();
        } catch (e) {
            setFormError(errorMessage(e));
        } finally {
            setSaving(false);
        }
    }

    async function trySave(e: React.FormEvent) {
        e.preventDefault();
        if (problems.length > 0 || !reasonOk) return;
        setSaving(true);
        setFormError(null);
        try {
            const latest = await admin.policy();
            if (versionChanged(loadedVersion.current, latest.active.version)) {
                setNewer(latest);
                setSaving(false);
                return;
            }
        } catch (err) {
            setFormError(errorMessage(err));
            setSaving(false);
            return;
        }
        await write();
    }

    return (
        <div className="space-y-8">
            <form onSubmit={trySave} noValidate className="space-y-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-8">
                <p className="text-sm text-gray-500">Editing from version {policy.active.version}.</p>
                <RefundTiersEditor
                    fields={fields} register={register}
                    onAdd={() => append({ minHoursBefore: 0, percent: 0 })} onRemove={remove}
                    onSort={() => setValue('refundTiers', sortTiers(getValues('refundTiers')))}
                />
                <div className="grid gap-5 sm:grid-cols-2">
                    {NUMBER_FIELDS.map((f) => (
                        <Field key={f.name} label={f.label} htmlFor={f.name} hint={`${f.hint} Allowed: ${f.range.min} to ${f.range.max}.`}>
                            <input id={f.name} type="number" step={1} className={inputCls} {...register(f.name, { valueAsNumber: true })} />
                        </Field>
                    ))}
                </div>
                <p className="text-sm text-gray-500">If the doctor does not show up, the patient always gets a full refund.</p>

                {problems.length > 0 && (
                    <ul role="alert" className="list-disc space-y-1 rounded-xl bg-red-50 p-4 pl-8 text-sm text-red-700">
                        {problems.map((p) => <li key={p}>{p}</li>)}
                    </ul>
                )}

                <Field label="Reason for this change" htmlFor="reason" hint="At least 3 characters. Kept in the version history.">
                    <textarea id="reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
                </Field>
                {formError && <p role="alert" className="text-sm font-semibold text-red-600">{formError}</p>}
                <Button type="submit" disabled={problems.length > 0 || !reasonOk || saving}>{saving ? 'Saving...' : 'Save new version'}</Button>
            </form>

            <section aria-labelledby="hist-h">
                <h2 id="hist-h" className="mb-3 text-lg font-semibold text-gray-900">Version history</h2>
                <ul className="space-y-3">
                    {policy.versions.map((v) => (
                        <li key={v.id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-gray-900">Version {v.version}</span>
                                {v.isActive && <Badge tone="success">In use</Badge>}
                                <span className="text-xs text-gray-500">{formatIstDateTime(v.createdAt)}</span>
                            </div>
                            {v.reason && <p className="mt-1 text-sm text-gray-700">{v.reason}</p>}
                            <p className="mt-1 text-xs text-gray-500">
                                Refunds: {sortTiers(v.rules.refundTiers).map((t) => `${t.percent}% from ${t.minHoursBefore}h`).join(', ')} · Fee {v.rules.platformFeeBps / 100}% · Hold {v.rules.holdMinutes} min
                            </p>
                        </li>
                    ))}
                </ul>
            </section>

            <Dialog open={newer !== null} onOpenChange={(o) => !o && !saving && setNewer(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>The rules changed while you were editing</DialogTitle>
                        <DialogDescription>
                            Another admin saved version {newer?.active.version}. Saving now replaces their changes with yours.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-wrap justify-end gap-2 pt-2">
                        <Button variant="outline" disabled={saving} onClick={() => { const n = newer; setNewer(null); if (n) void reload(); }}>Use the latest rules</Button>
                        <Button disabled={saving} onClick={write}>{saving ? 'Saving...' : 'Save mine anyway'}</Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
