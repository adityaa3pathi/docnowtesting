'use client';
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, HelpCircle, Loader2, Pencil } from 'lucide-react';
import { HealthDetailsForm } from '@/components/health/HealthDetailsForm';
import { Button } from '@/components/ui';
import { errorMessage } from '@/lib/consult/api';
import { allergyState, healthApi, isSelfPerson, type HealthPerson } from '@/lib/health';

function sortPeople(list: HealthPerson[]) {
    return [...list].sort((a, b) => (isSelfPerson(a) === isSelfPerson(b) ? a.name.localeCompare(b.name) : isSelfPerson(a) ? -1 : 1));
}

function AllergySummary({ person }: { person: HealthPerson }) {
    const state = allergyState(person);
    if (state === 'listed') {
        return (
            <p className="flex items-start gap-1.5 text-sm font-semibold text-danger-ink">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Allergies: {person.allergies!.join(', ')}
            </p>
        );
    }
    if (state === 'none') {
        return <p className="flex items-center gap-1.5 text-sm text-success-ink"><CheckCircle2 className="h-4 w-4" aria-hidden /> No known allergies</p>;
    }
    return <p className="flex items-center gap-1.5 text-sm font-medium text-amber-800"><HelpCircle className="h-4 w-4" aria-hidden /> Allergies not added yet</p>;
}

/** Health details for the account holder and each family member, as doctors will see them. */
export function HealthTab() {
    const [people, setPeople] = useState<HealthPerson[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                try { await healthApi.ensureSelf(); } catch { /* a thin profile can't make "Self" yet */ }
                const list = await healthApi.people();
                if (alive) setPeople(sortPeople(list));
            } catch (e) {
                if (alive) setError(errorMessage(e));
            }
        })();
        return () => { alive = false; };
    }, []);

    if (error) return <p role="alert" className="py-8 text-center text-sm text-danger-ink">{error}</p>;
    if (!people) return <div className="flex justify-center py-12"><Loader2 className="animate-spin" aria-label="Loading health details" /></div>;

    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-xl font-bold text-ink">Health details</h2>
                <p className="text-sm text-ink-muted">Your doctor sees these before and during a consultation. Keep allergies up to date.</p>
            </div>
            {people.length === 0 && <p className="py-8 text-center text-sm text-ink-muted">Complete your profile first, then add your health details here.</p>}
            <ul className="space-y-3">
                {people.map((p) => (
                    <li key={p.id} className="space-y-3 rounded-xl border border-border bg-surface p-4">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 space-y-1">
                                <p className="truncate font-semibold text-ink">{isSelfPerson(p) ? `${p.name} (you)` : `${p.name} · ${p.relation}`}</p>
                                <AllergySummary person={p} />
                                {(p.chronicConditions?.length || p.currentMedications?.length || p.bloodGroup) ? (
                                    <p className="text-sm text-ink-muted">
                                        {[p.chronicConditions?.join(', '), p.currentMedications?.length ? `Takes ${p.currentMedications.join(', ')}` : '', p.bloodGroup ? `Blood group ${p.bloodGroup}` : '']
                                            .filter(Boolean).join(' · ')}
                                    </p>
                                ) : null}
                            </div>
                            {editing !== p.id && (
                                <Button size="sm" variant="secondary" onClick={() => setEditing(p.id)} aria-label={`Edit health details for ${p.name}`}>
                                    <Pencil className="h-4 w-4" aria-hidden /> Edit
                                </Button>
                            )}
                        </div>
                        {editing === p.id && (
                            <HealthDetailsForm
                                person={p}
                                onSkip={() => setEditing(null)}
                                skipLabel="Cancel"
                                onSaved={(saved) => {
                                    setPeople((cur) => cur && cur.map((x) => (x.id === saved.id ? saved : x)));
                                    setEditing(null);
                                }}
                            />
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}
