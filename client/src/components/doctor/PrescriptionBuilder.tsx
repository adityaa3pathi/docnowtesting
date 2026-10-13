'use client';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { ConfirmDialog } from '@/components/consult/ConfirmDialog';
import { doctor as doctorApi } from '@/lib/consult/api';
import { buildPrescription, emptyMedicine } from '@/lib/consult/room';
import type { Medicine, Prescription, PrescriptionInput } from '@/lib/consult/types';

const COLUMNS = [
    { key: 'name', label: 'Medicine', placeholder: 'Name' },
    { key: 'dose', label: 'Dose', placeholder: '500 mg' },
    { key: 'frequency', label: 'How often', placeholder: 'Twice a day' },
    { key: 'duration', label: 'For how long', placeholder: '5 days' },
    { key: 'instructions', label: 'Instructions', placeholder: 'After food' },
] as const;

const fieldCls = 'w-full rounded-xl border border-border bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring';

/** Writes the prescription once. The server never lets it change, so issuing asks for a confirm first. */
export function PrescriptionBuilder({ consultationId, onIssued }: { consultationId: string; onIssued: (p: Prescription) => void }) {
    const [rows, setRows] = useState<Medicine[]>([emptyMedicine()]);
    const [codes, setCodes] = useState('');
    const [advice, setAdvice] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState<PrescriptionInput | null>(null);

    const setCell = (i: number, key: keyof Medicine, value: string) =>
        setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [key]: value } : r)));

    function review() {
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
            <h2 className="font-bold text-foreground">Prescription</h2>
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
                                <input id={`rx-${i}-${c.key}`} value={row[c.key]} placeholder={`${c.label}: ${c.placeholder}`}
                                    maxLength={c.key === 'name' ? 120 : c.key === 'instructions' ? 200 : 60}
                                    onChange={(e) => setCell(i, c.key, e.target.value)} className={fieldCls} />
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
                <input id="rx-tests" value={codes} onChange={(e) => setCodes(e.target.value)} className={fieldCls} placeholder="e.g. CBC, TSH" />
                <p className="mt-1 text-xs text-muted-foreground">Catalog test codes, separated by commas. Names show after you issue.</p>
            </div>
            <div>
                <label htmlFor="rx-advice" className="mb-1 block text-sm font-semibold text-foreground">Advice</label>
                <textarea id="rx-advice" value={advice} maxLength={2000} onChange={(e) => setAdvice(e.target.value)} className={`${fieldCls} min-h-20`} />
            </div>
            {error && <p role="alert" className="text-sm font-semibold text-destructive">{error}</p>}
            <Button className="w-full" onClick={review}>Issue prescription</Button>
            <ConfirmDialog
                open={pending !== null}
                title="Issue this prescription?"
                description="Once issued, the prescription cannot be changed, and your notes are locked. The patient sees it straight away."
                confirmLabel="Issue prescription"
                onClose={() => setPending(null)}
                onConfirm={async () => {
                    if (!pending) return;
                    onIssued(await doctorApi.issuePrescription(consultationId, pending));
                }}
            />
        </section>
    );
}
