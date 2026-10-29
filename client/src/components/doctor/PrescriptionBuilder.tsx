'use client';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { ConfirmDialog } from '@/components/consult/ConfirmDialog';
import { doctor as doctorApi } from '@/lib/consult/api';
import { REISSUE_REASON_MAX, REISSUE_REASON_MIN, buildPrescription, builderFromPrescription, emptyBuilder, emptyMedicine } from '@/lib/consult/room';
import type { Medicine, Prescription, PrescriptionInput } from '@/lib/consult/types';

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

// Common lab test code suggestions
const TEST_SUGGESTIONS = [
    'CBC', 'Lipid Profile', 'LFT', 'KFT', 'RFT', 'TSH', 'T3', 'T4', 'HbA1c', 'FBS', 'PPBS',
    'Vitamin D', 'Vitamin B12', 'Serum Iron', 'Ferritin', 'Urine Routine', 'Urine Culture',
    'Blood Culture', 'CRP', 'ESR', 'RA Factor', 'ANA', 'Dengue NS1', 'Malaria Antigen',
    'Widal Test', 'HBsAg', 'Anti-HCV', 'HIV', 'VDRL', 'PT/INR', 'APTT', 'D-Dimer',
    'Serum Calcium', 'Serum Uric Acid', 'Lipase', 'Amylase', 'PSA', 'CEA', 'CA-125',
    'ECG', 'Chest X-Ray', 'USG Abdomen', '2D Echo', 'PFT', 'TMT', 'Hb Electrophoresis',
];

const COLUMNS = [
    { key: 'name', label: 'Medicine', placeholder: 'Name' },
    { key: 'dose', label: 'Dose', placeholder: '500 mg' },
    { key: 'frequency', label: 'How often', placeholder: 'Twice a day' },
    { key: 'duration', label: 'For how long', placeholder: '5 days' },
    { key: 'instructions', label: 'Instructions', placeholder: 'After food' },
] as const;

const fieldCls = 'w-full rounded-xl border border-border bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring';

interface Props {
    consultationId: string;
    /** When set, the form corrects this version: it starts pre-filled and needs a reason. */
    correcting?: Prescription;
    onIssued: (p: Prescription) => void;
    onCancel?: () => void;
}

/** Issues a prescription, or a corrected next version. Both ask for a confirm because neither can be undone. */
export function PrescriptionBuilder({ consultationId, correcting, onIssued, onCancel }: Props) {
    const [initial] = useState(() => (correcting ? builderFromPrescription(correcting) : emptyBuilder()));
    const [rows, setRows] = useState<Medicine[]>(initial.rows);
    const [codes, setCodes] = useState(initial.codes);
    const [advice, setAdvice] = useState(initial.advice);
    const [reason, setReason] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState<PrescriptionInput | null>(null);

    const setCell = (i: number, key: keyof Medicine, value: string) =>
        setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [key]: value } : r)));

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
                        {COLUMNS.map((c) => (
                            <div key={c.key}>
                                <label htmlFor={`rx-${i}-${c.key}`} className="sr-only">{c.label} {i + 1}</label>
                                {c.key === 'name' ? (
                                    <>
                                        <input id={`rx-${i}-${c.key}`} value={row[c.key]} placeholder={`${c.label}: ${c.placeholder}`}
                                            maxLength={120} list={`drug-suggestions-${i}`}
                                            onChange={(e) => setCell(i, c.key, e.target.value)} className={fieldCls} />
                                        <datalist id={`drug-suggestions-${i}`}>
                                            {DRUG_SUGGESTIONS.filter((d) => !row[c.key] || d.toLowerCase().includes(row[c.key].toLowerCase())).map((d) => (
                                                <option key={d} value={d} />
                                            ))}
                                        </datalist>
                                    </>
                                ) : (
                                    <input id={`rx-${i}-${c.key}`} value={row[c.key]} placeholder={`${c.label}: ${c.placeholder}`}
                                        maxLength={c.key === 'instructions' ? 200 : 60}
                                        onChange={(e) => setCell(i, c.key, e.target.value)} className={fieldCls} />
                                )}
                            </div>
                        ))}
                    </li>
                ))}
            </ol>
            <Button variant="outline" size="sm" disabled={rows.length >= 20} onClick={() => setRows((rs) => [...rs, emptyMedicine()])}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Add medicine
            </Button>
            <div>
                <label htmlFor="rx-tests" className="mb-1 block text-sm font-semibold text-foreground">Recommended test codes</label>
                <input id="rx-tests" value={codes} onChange={(e) => setCodes(e.target.value)} className={fieldCls}
                    placeholder="e.g. CBC, TSH" list="test-suggestions" />
                <datalist id="test-suggestions">
                    {TEST_SUGGESTIONS.filter((t) => !codes || t.toLowerCase().includes(codes.split(/[\s,]+/).pop()?.toLowerCase() || '')).map((t) => (
                        <option key={t} value={t} />
                    ))}
                </datalist>
                <p className="mt-1 text-xs text-muted-foreground">Catalog test codes, separated by commas. Names show after you issue.</p>
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
