'use client';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { doctor as doctorApi, errorMessage } from '@/lib/consult/api';
import { formatIstTime } from '@/lib/consult/time';
import type { ConsultNote, NoteInput } from '@/lib/consult/types';

const FIELDS = [
    { key: 'complaints', label: 'Complaints', max: 2000 },
    { key: 'findings', label: 'Findings', max: 2000 },
    { key: 'diagnosis', label: 'Diagnosis', max: 1000 },
    { key: 'advice', label: 'Advice', max: 2000 },
] as const;

type Key = (typeof FIELDS)[number]['key'];
type Form = Record<Key, string> & { followUp: string };

const fromNote = (n: ConsultNote | null): Form => ({
    complaints: n?.complaints ?? '', findings: n?.findings ?? '', diagnosis: n?.diagnosis ?? '', advice: n?.advice ?? '',
    followUp: n?.followUpDays ? String(n.followUpDays) : '',
});

const fieldCls = 'w-full rounded-xl border border-border bg-input p-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60';

interface Props {
    consultationId: string;
    note: ConsultNote | null;
    /** Why notes cannot be edited right now, or null when they can. */
    lockedReason: string | null;
}

/** Private doctor notes. Saves when a field loses focus, or on Save. */
export function NotesForm({ consultationId, note, lockedReason }: Props) {
    const [form, setForm] = useState<Form>(() => fromNote(note));
    const saved = useRef(JSON.stringify(fromNote(note)));
    const [savedAt, setSavedAt] = useState<string | null>(note?.updatedAt ?? null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const locked = lockedReason !== null;

    async function save(force: boolean) {
        const snapshot = JSON.stringify(form);
        if (locked || saving || (!force && snapshot === saved.current)) return;
        const days = form.followUp.trim() ? Number(form.followUp) : null;
        if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) {
            setError('Follow-up must be a whole number of days, 1 to 365.');
            return;
        }
        const body: NoteInput = { complaints: form.complaints, findings: form.findings, diagnosis: form.diagnosis, advice: form.advice, followUpDays: days };
        setSaving(true);
        setError(null);
        try {
            const res = await doctorApi.saveNotes(consultationId, body);
            saved.current = snapshot;
            setSavedAt(res.updatedAt);
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setSaving(false);
        }
    }

    const set = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

    return (
        <section aria-label="Notes" className="space-y-3 rounded-2xl border border-border bg-white p-4">
            <div className="flex items-center justify-between gap-2">
                <h2 className="font-bold text-foreground">Notes</h2>
                <p aria-live="polite" className="text-xs text-muted-foreground">
                    {saving ? 'Saving...' : savedAt ? `Saved ${formatIstTime(savedAt)}` : ''}
                </p>
            </div>
            {lockedReason && <p className="rounded-xl bg-gray-100 px-3 py-2 text-sm text-gray-700">{lockedReason}</p>}
            {FIELDS.map((f) => (
                <div key={f.key}>
                    <label htmlFor={`note-${f.key}`} className="mb-1 block text-sm font-semibold text-foreground">{f.label}</label>
                    <textarea id={`note-${f.key}`} value={form[f.key]} maxLength={f.max} disabled={locked}
                        onChange={set(f.key)} onBlur={() => void save(false)} className={`${fieldCls} min-h-20`} />
                </div>
            ))}
            <div>
                <label htmlFor="note-followup" className="mb-1 block text-sm font-semibold text-foreground">Follow up after (days)</label>
                <input id="note-followup" type="number" inputMode="numeric" min={1} max={365} value={form.followUp} disabled={locked}
                    onChange={set('followUp')} onBlur={() => void save(false)} className={fieldCls} />
            </div>
            {error && <p role="alert" className="text-sm font-semibold text-destructive">{error}</p>}
            {!locked && (
                <Button variant="outline" size="sm" disabled={saving} onClick={() => void save(true)}>Save notes</Button>
            )}
        </section>
    );
}
