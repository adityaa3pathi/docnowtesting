'use client';
import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui';
import { errorMessage } from '@/lib/consult/api';
import { addTags, BLOOD_GROUPS, formFromPerson, healthApi, healthBody, isSelfPerson, type HealthForm, type HealthPerson } from '@/lib/health';
import { TagField } from './TagField';

const ALLERGY_SUGGESTIONS = ['Penicillin', 'Sulfa drugs', 'Aspirin', 'Ibuprofen', 'Peanuts', 'Dust'];

interface Props {
    person: HealthPerson;
    /** `allergies`: just the allergy question (sign-up and booking prompts). `full`: everything. */
    mode?: 'full' | 'allergies';
    onSaved: (person: HealthPerson) => void;
    /** Shown as a second button, e.g. "Skip for now" or "Cancel". */
    onSkip?: () => void;
    skipLabel?: string;
    saveLabel?: string;
    /** Told whether anything was typed or picked but not saved yet. */
    onDirtyChange?: (dirty: boolean) => void;
}

/** Allergies (with "No known allergies"), and in full mode conditions, medicines and blood group. */
export function HealthDetailsForm({ person, mode = 'full', onSaved, onSkip, skipLabel = 'Skip for now', saveLabel = 'Save', onDirtyChange }: Props) {
    const [form, setForm] = useState<HealthForm>(() => formFromPerson(person));
    const [drafts, setDrafts] = useState({ allergies: '', chronicConditions: '', currentMedications: '' });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const full = mode === 'full';
    const who = isSelfPerson(person) ? 'you' : person.name;
    const set = (patch: Partial<HealthForm>) => setForm((f) => ({ ...f, ...patch }));
    const setDraft = (key: keyof typeof drafts) => (v: string) => setDrafts((d) => ({ ...d, [key]: v }));

    async function save() {
        // Anything still typed in a box counts, so a person who never pressed Add loses nothing;
        // if it can't be added (too long, too many), say so instead of saving without it.
        const added = {
            allergies: addTags(form.allergies, drafts.allergies),
            chronicConditions: addTags(form.chronicConditions, drafts.chronicConditions),
            currentMedications: addTags(form.currentMedications, drafts.currentMedications),
        };
        const LABEL = { allergies: 'Allergies', chronicConditions: 'Conditions', currentMedications: 'Medicines' } as const;
        const problem = (Object.keys(added) as (keyof typeof added)[]).find((k) => added[k].error);
        if (problem) {
            setError(`${LABEL[problem]}: ${added[problem].error} Nothing was saved.`);
            return;
        }
        const withDrafts: HealthForm = {
            ...form,
            allergies: added.allergies.list,
            chronicConditions: added.chronicConditions.list,
            currentMedications: added.currentMedications.list,
        };
        if (!full && !withDrafts.allergies.length && !withDrafts.noKnownAllergies) {
            setError('Add an allergy, or tick "No known allergies".');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            onSaved(await healthApi.save(person.id, healthBody(withDrafts, !full)));
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setBusy(false);
        }
    }

    const [initial] = useState(form);
    const dirty = JSON.stringify(form) !== JSON.stringify(initial) || Object.values(drafts).some((d) => d.trim());
    useEffect(() => {
        onDirtyChange?.(dirty);
    }, [dirty, onDirtyChange]);
    // Leaving (another person picked, or saved) takes the unsaved state with it.
    useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

    const hasAllergies = form.allergies.length > 0 || !!drafts.allergies.trim();
    return (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <div className="space-y-3 rounded-xl border border-danger/30 bg-danger-soft/40 p-3">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-danger-ink">
                    <AlertTriangle className="h-4 w-4" aria-hidden /> Allergies
                </p>
                <TagField
                    label={isSelfPerson(person) ? 'Medicines or foods you are allergic to' : `Medicines or foods ${person.name} is allergic to`}
                    hint="Doctors see this before they prescribe."
                    values={form.allergies}
                    onChange={(allergies) => set({ allergies, ...(allergies.length ? { noKnownAllergies: false } : {}) })}
                    draft={drafts.allergies}
                    onDraftChange={setDraft('allergies')}
                    placeholder="e.g. Penicillin"
                    suggestions={ALLERGY_SUGGESTIONS}
                    tone="warn"
                    disabled={form.noKnownAllergies}
                />
                <label className="flex cursor-pointer items-start gap-2 text-sm text-ink">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={form.noKnownAllergies} disabled={hasAllergies}
                        onChange={(e) => set({ noKnownAllergies: e.target.checked })} />
                    <span>
                        <span className="font-medium">No known allergies</span>
                        {hasAllergies && <span className="block text-xs text-ink-muted">Remove the allergies above to tick this.</span>}
                    </span>
                </label>
            </div>

            {full && (
                <>
                    <TagField label="Long-term conditions" values={form.chronicConditions} onChange={(chronicConditions) => set({ chronicConditions })}
                        draft={drafts.chronicConditions} onDraftChange={setDraft('chronicConditions')} placeholder="e.g. Diabetes, BP"
                        suggestions={['Diabetes', 'High BP', 'Thyroid', 'Asthma']} />
                    <TagField label="Medicines taken daily" values={form.currentMedications} onChange={(currentMedications) => set({ currentMedications })}
                        draft={drafts.currentMedications} onDraftChange={setDraft('currentMedications')} placeholder="e.g. Metformin 500 mg" />
                    <div className="space-y-1.5">
                        <label htmlFor={`blood-${person.id}`} className="block text-sm font-medium text-ink">Blood group</label>
                        <select id={`blood-${person.id}`} value={form.bloodGroup} onChange={(e) => set({ bloodGroup: e.target.value })}
                            className="h-11 w-full rounded-lg border border-border-strong bg-surface px-3 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                            <option value="">Don&apos;t know</option>
                            {BLOOD_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>
                    </div>
                </>
            )}

            {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-danger-ink">{error}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
                {onSkip && <Button type="button" variant="secondary" className="sm:flex-1" onClick={onSkip} disabled={busy}>{skipLabel}</Button>}
                <Button type="submit" className="sm:flex-1" loading={busy}>{saveLabel}</Button>
            </div>
            {!full && <p className="text-center text-xs text-ink-muted">Saved to {who === 'you' ? 'your' : `${who}'s`} health details. You can change it any time in your profile.</p>}
        </form>
    );
}
