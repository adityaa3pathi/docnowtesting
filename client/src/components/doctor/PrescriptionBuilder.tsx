'use client';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { ConfirmDialog } from '@/components/consult/ConfirmDialog';
import { TestSelector } from './TestSelector';
import { doctor as doctorApi } from '@/lib/consult/api';
import { DURATION_DAYS_MAX, REISSUE_REASON_MAX, REISSUE_REASON_MIN, buildPrescription, builderFromPrescription, emptyBuilder, emptyMedicine, parseTestCodes } from '@/lib/consult/room';
import { DOSE_TIMES, FOOD_TIMINGS } from '@/lib/consult/medicine';
import type { DoseTime, FoodTiming, Medicine, Prescription, PrescriptionInput } from '@/lib/consult/types';
import { cn } from '@/lib/utils';
import { AllergyAlert } from './AllergyAlert';

// Common drug name suggestions for autocomplete
const DRUG_SUGGESTIONS = [
    'Paracetamol', 'Amoxicillin', 'Azithromycin', 'Cetirizine', 'Diclofenac', 'Domperidone',
    'Levocetirizine', 'Metformin', 'Omeprazole', 'Pantoprazole', 'Ranitidine', 'Ciprofloxacin',
    'Doxycycline', 'Ibuprofen', 'Losartan', 'Amlodipine', 'Atorvastatin', 'Metronidazole',
    'Ondansetron', 'Prednisolone', 'Salbutamol', 'Cough Syrup', 'Multivitamin', 'Calcium + D3',
    'Iron + Folic Acid', 'B-Complex', 'Vitamin C', 'Zinc', 'Montelukast', 'Ofloxacin',
    'Cefixime', 'Clarithromycin', 'Fluconazole', 'Ketoconazole', 'Clotrimazole', 'Betamethasone',
    'Hydrocortisone', 'Dexamethasone', 'Atenolol', 'Enalapril', 'Ramipril', 'Telmisartan',
    'Hydrochlorothiazide', 'Furosemide', 'Glimepiride', 'Insulin', 'Thyroxine', 'Carbimazole',
];

const fieldCls = 'w-full rounded-xl border border-border bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring';
const labelCls = 'mb-1 block text-xs font-semibold text-muted-foreground';

interface Props {
    consultationId: string;
    /** When set, the form corrects this version: it starts pre-filled and needs a reason. */
    correcting?: Prescription;
    onIssued: (p: Prescription) => void;
    onCancel?: () => void;
    /** The patient's allergies, shown on top of the form. */
    patient?: { allergies?: string[]; allergiesConfirmedAt?: string | null };
}

/** Issues a prescription, or a corrected next version. Both ask for a confirm because neither can be undone. */
export function PrescriptionBuilder({ consultationId, correcting, onIssued, onCancel, patient }: Props) {
    const [initial] = useState(() => (correcting ? builderFromPrescription(correcting) : emptyBuilder()));
    const [rows, setRows] = useState<Medicine[]>(initial.rows);
    const [codes, setCodes] = useState(initial.codes);
    const [advice, setAdvice] = useState(initial.advice);
    const [reason, setReason] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState<PrescriptionInput | null>(null);

    const setRow = (i: number, patch: Partial<Medicine>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    const toggleTime = (i: number, t: DoseTime) => {
        const cur = rows[i]?.doseTimes ?? [];
        setRow(i, { doseTimes: cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t] });
    };

    function review() {
        if (correcting && reason.trim().length < REISSUE_REASON_MIN) {
            setError('Say briefly why you are correcting the prescription.');
            return;
        }
        const built = buildPrescription(rows, codes, advice);
        if (!built.ok) {
            setError(built.error);
            return;
        }
        setError(null);
        setPending(built.body);
    }

    return (
        <section aria-label="Prescription" className="space-y-3 rounded-2xl border border-border bg-white p-4">
            <h2 className="font-bold text-foreground">{correcting ? `Correct prescription (version ${correcting.version})` : 'Prescription'}</h2>
            {patient && <AllergyAlert allergies={patient.allergies} allergiesConfirmedAt={patient.allergiesConfirmedAt} />}
            <ol className="space-y-3">
                {rows.map((row, i) => (
                    <li key={i} className="space-y-2 rounded-xl bg-primary/5 p-3">
                        <div className="flex items-center justify-between">
                            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Medicine {i + 1}</p>
                            <button type="button" aria-label={`Remove medicine ${i + 1}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                                className="rounded-lg p-1 text-gray-500 hover:bg-white hover:text-destructive">
                                <Trash2 className="h-4 w-4" aria-hidden />
                            </button>
                        </div>
                        <div>
                            <label htmlFor={`rx-${i}-name`} className="sr-only">Medicine {i + 1}</label>
                            <input id={`rx-${i}-name`} value={row.name} placeholder="Medicine name" maxLength={120} list={`drug-suggestions-${i}`}
                                onChange={(e) => setRow(i, { name: e.target.value })} className={fieldCls} />
                            <datalist id={`drug-suggestions-${i}`}>
                                {DRUG_SUGGESTIONS.filter((d) => !row.name || d.toLowerCase().includes(row.name.toLowerCase())).map((d) => (
                                    <option key={d} value={d} />
                                ))}
                            </datalist>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label htmlFor={`rx-${i}-strength`} className={labelCls}>Strength</label>
                                <input id={`rx-${i}-strength`} value={row.strength ?? ''} placeholder="650 mg" maxLength={40}
                                    onChange={(e) => setRow(i, { strength: e.target.value })} className={fieldCls} />
                            </div>
                            <div>
                                <label htmlFor={`rx-${i}-dose`} className={labelCls}>Dose each time</label>
                                <input id={`rx-${i}-dose`} value={row.dose} placeholder="1 tablet" maxLength={60}
                                    onChange={(e) => setRow(i, { dose: e.target.value })} className={fieldCls} />
                            </div>
                        </div>
                        <fieldset>
                            <legend className={labelCls}>When</legend>
                            <div className="flex flex-wrap gap-1.5">
                                {DOSE_TIMES.map((t) => {
                                    const on = row.doseTimes?.includes(t.value) ?? false;
                                    return (
                                        <button key={t.value} type="button" aria-pressed={on} onClick={() => toggleTime(i, t.value)}
                                            className={cn('rounded-lg border px-3 py-1.5 text-sm font-semibold', on ? 'border-primary bg-primary text-white' : 'border-border bg-white text-foreground hover:border-primary')}>
                                            {t.label}
                                        </button>
                                    );
                                })}
                            </div>
                            <label htmlFor={`rx-${i}-frequency`} className="sr-only">Other timing {i + 1}</label>
                            <input id={`rx-${i}-frequency`} value={row.frequency} placeholder="Or other timing: Only when needed, once a week" maxLength={60}
                                onChange={(e) => setRow(i, { frequency: e.target.value })} className={cn(fieldCls, 'mt-1.5')} />
                        </fieldset>
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label htmlFor={`rx-${i}-food`} className={labelCls}>Food</label>
                                <select id={`rx-${i}-food`} value={row.foodTiming ?? ''} className={fieldCls}
                                    onChange={(e) => setRow(i, { foodTiming: (e.target.value || null) as FoodTiming | null })}>
                                    <option value="">Any time</option>
                                    {FOOD_TIMINGS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                                </select>
                            </div>
                            <div>
                                <label htmlFor={`rx-${i}-days`} className={labelCls}>Days</label>
                                <input id={`rx-${i}-days`} type="number" inputMode="numeric" min={1} max={DURATION_DAYS_MAX} placeholder="5"
                                    value={row.durationDays ?? ''} className={fieldCls}
                                    onChange={(e) => setRow(i, { durationDays: e.target.value === '' ? null : Number(e.target.value) })} />
                            </div>
                        </div>
                        {/* A correction of a prescription from before the Days box keeps its old text until replaced. */}
                        {!!initial.rows[i]?.duration && (
                            <div>
                                <label htmlFor={`rx-${i}-duration`} className={labelCls}>For how long (earlier version)</label>
                                <input id={`rx-${i}-duration`} value={row.duration} maxLength={60}
                                    onChange={(e) => setRow(i, { duration: e.target.value })} className={fieldCls} />
                            </div>
                        )}
                        <div>
                            <label htmlFor={`rx-${i}-instructions`} className="sr-only">Instructions {i + 1}</label>
                            <input id={`rx-${i}-instructions`} value={row.instructions} placeholder="Instructions: Stop if the fever goes" maxLength={200}
                                onChange={(e) => setRow(i, { instructions: e.target.value })} className={fieldCls} />
                        </div>
                    </li>
                ))}
            </ol>
            <Button variant="outline" size="sm" disabled={rows.length >= 20} onClick={() => setRows((rs) => [...rs, emptyMedicine()])}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Add medicine
            </Button>
            <div>
                <label className="mb-2 block text-sm font-semibold text-foreground">Recommended tests</label>
                <TestSelector
                    selectedCodes={parseTestCodes(codes)}
                    onChange={(newCodes) => setCodes(newCodes.join(', '))}
                    knownNames={correcting && Object.fromEntries(correcting.recommendedTests.map((t) => [t.code, t.name]))}
                />
            </div>
            <div>
                <label htmlFor="rx-advice" className="mb-1 block text-sm font-semibold text-foreground">Advice</label>
                <textarea id="rx-advice" value={advice} maxLength={2000} onChange={(e) => setAdvice(e.target.value)} className={`${fieldCls} min-h-20`} />
            </div>
            {correcting && (
                <div>
                    <label htmlFor="rx-reason" className="mb-1 block text-sm font-semibold text-foreground">Reason for the correction</label>
                    <textarea id="rx-reason" value={reason} maxLength={REISSUE_REASON_MAX} onChange={(e) => setReason(e.target.value)}
                        className={`${fieldCls} min-h-16`} placeholder="e.g. Wrong dose for paracetamol" />
                    <p className="mt-1 text-xs text-muted-foreground">Kept with the old version. The patient does not see it.</p>
                </div>
            )}
            {error && <p role="alert" className="text-sm font-semibold text-destructive">{error}</p>}
            <div className="flex gap-2">
                {onCancel && <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>}
                <Button className="flex-1" onClick={review}>{correcting ? 'Issue corrected version' : 'Issue prescription'}</Button>
            </div>
            <ConfirmDialog
                open={pending !== null}
                title={correcting ? 'Issue the corrected prescription?' : 'Issue this prescription?'}
                description={correcting
                    ? 'The current version will be marked void and the patient will see the new one.'
                    : 'The patient sees it straight away and your notes lock. Any later correction is kept as a new version.'}
                confirmLabel={correcting ? 'Issue corrected version' : 'Issue prescription'}
                onClose={() => setPending(null)}
                onConfirm={async () => {
                    if (!pending) return;
                    onIssued(correcting
                        ? await doctorApi.reissuePrescription(consultationId, { reason: reason.trim(), prescription: pending })
                        : await doctorApi.issuePrescription(consultationId, pending));
                }}
            />
        </section>
    );
}
