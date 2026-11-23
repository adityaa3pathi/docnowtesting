'use client';
import { useEffect, useState } from 'react';
import { admin } from '@/lib/consult/api';
import { APPLIES_TO_LABEL, type PromoAppliesTo } from '@/lib/promoScope';

interface Props {
    appliesTo: PromoAppliesTo;
    doctorIds: string[];
    specialtyIds: string[];
    onChange: (next: { appliesTo: PromoAppliesTo; doctorIds: string[]; specialtyIds: string[] }) => void;
}

type Option = { id: string; name: string };

function CheckList({ legend, options, selected, onToggle }: { legend: string; options: Option[]; selected: string[]; onToggle: (id: string) => void }) {
    return (
        <fieldset>
            <legend className="mb-1 block text-sm font-medium text-gray-700">{legend}</legend>
            {options.length === 0 ? (
                <p className="text-xs text-gray-400">None yet.</p>
            ) : (
                <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-gray-200 p-2">
                    {options.map((o) => (
                        <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm text-gray-700 hover:bg-gray-50">
                            <input type="checkbox" className="h-4 w-4 accent-[#4b2192]" checked={selected.includes(o.id)} onChange={() => onToggle(o.id)} />
                            <span className="min-w-0 truncate">{o.name}</span>
                        </label>
                    ))}
                </div>
            )}
        </fieldset>
    );
}

/**
 * Where the code works, and (for consultations) an optional limit to some doctors or specialties.
 * The consult-home concern tiles each map to a specialty, so picking a specialty covers that concern.
 */
export function PromoScopeFields({ appliesTo, doctorIds, specialtyIds, onChange }: Props) {
    const [doctors, setDoctors] = useState<Option[]>([]);
    const [specialties, setSpecialties] = useState<Option[]>([]);
    const [loadError, setLoadError] = useState(false);
    const consult = appliesTo !== 'LAB';

    useEffect(() => {
        if (!consult) return;
        let alive = true;
        Promise.all([admin.doctors('APPROVED'), admin.specialties()])
            .then(([d, s]) => {
                if (!alive) return;
                setDoctors(d.map((x) => ({ id: x.id, name: `${x.displayName} (${x.specialty?.name ?? 'doctor'})` })));
                setSpecialties(s.map((x) => ({ id: x.id, name: x.name })));
            })
            .catch(() => { if (alive) setLoadError(true); });
        return () => {
            alive = false;
        };
    }, [consult]);

    const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

    return (
        <div className="space-y-4">
            <div>
                <label htmlFor="promo-applies-to" className="mb-1 block text-sm font-medium text-gray-700">Works on</label>
                <select
                    id="promo-applies-to"
                    value={appliesTo}
                    onChange={(e) => onChange({ appliesTo: e.target.value as PromoAppliesTo, doctorIds, specialtyIds })}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2 focus:border-[#4b2192] focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20"
                >
                    {(Object.keys(APPLIES_TO_LABEL) as PromoAppliesTo[]).map((k) => <option key={k} value={k}>{APPLIES_TO_LABEL[k]}</option>)}
                </select>
            </div>
            {consult && (
                <>
                    <p className="text-xs text-gray-500">
                        For consultations, leave both lists empty for any doctor, or tick doctors and/or specialties to limit it.
                        A specialty also covers its concern on the consult home page. The discount is borne by DocNow.
                    </p>
                    {loadError && <p className="text-xs text-red-500">Could not load doctors and specialties. Reload to try again.</p>}
                    <CheckList legend="Only these specialties" options={specialties} selected={specialtyIds} onToggle={(id) => onChange({ appliesTo, doctorIds, specialtyIds: toggle(specialtyIds, id) })} />
                    <CheckList legend="Only these doctors" options={doctors} selected={doctorIds} onToggle={(id) => onChange({ appliesTo, doctorIds: toggle(doctorIds, id), specialtyIds })} />
                </>
            )}
        </div>
    );
}
