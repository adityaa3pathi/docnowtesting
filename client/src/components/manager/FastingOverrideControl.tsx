'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import api from '@/lib/api';

const MAX_FASTING_HOURS = 24; // keep in sync with server MAX_FASTING_HOURS

type Choice = 'partner' | 'Not Required' | 'Required';

export interface FastingFields {
    id: string;
    name: string;
    fastingOverride: 'Required' | 'Not Required' | null;
    fastingTimeOverride: string | null;
    detailsData?: { fasting?: string | null; fastingTime?: string | null } | null;
}

function hoursOf(label: string | null): string {
    const match = label?.match(/\d+/);
    return match ? match[0] : '';
}

function apiError(error: unknown): string {
    const data = (error as { response?: { data?: { error?: unknown } } })?.response?.data;
    return typeof data?.error === 'string' ? data.error : 'Could not save. Please try again.';
}

/**
 * Correct the fasting facts Healthians sends for one product. The correction replaces Healthians'
 * values on cards, product pages and in the support chat; "Healthians value" removes it.
 */
export function FastingOverrideControl({ item, onSaved }: {
    item: FastingFields;
    onSaved: (saved: Pick<FastingFields, 'fastingOverride' | 'fastingTimeOverride'>) => void;
}) {
    const savedChoice: Choice = item.fastingOverride ?? 'partner';
    const savedHours = hoursOf(item.fastingTimeOverride);
    const [choice, setChoice] = useState<Choice>(savedChoice);
    const [hours, setHours] = useState(savedHours);
    const [status, setStatus] = useState<{ kind: 'saving' | 'saved' } | { kind: 'error'; message: string } | null>(null);

    const partner = [item.detailsData?.fasting, item.detailsData?.fastingTime].filter(Boolean).join(', ') || 'not given';
    const hoursNum = hours.trim() === '' ? null : Number(hours);
    const hoursInvalid = choice === 'Required' && hoursNum !== null
        && (!Number.isInteger(hoursNum) || hoursNum < 1 || hoursNum > MAX_FASTING_HOURS);
    const dirty = choice !== savedChoice || (choice === 'Required' && hours.trim() !== savedHours);
    const saving = status?.kind === 'saving';
    const selectId = `fasting-${item.id}`;

    const save = async () => {
        setStatus({ kind: 'saving' });
        try {
            const body = choice === 'partner'
                ? { fasting: null }
                : choice === 'Required' ? { fasting: 'Required', fastingHours: hoursNum } : { fasting: 'Not Required' };
            const res = await api.put(`/manager/catalog/${item.id}/fasting`, body);
            onSaved({ fastingOverride: res.data.fastingOverride ?? null, fastingTimeOverride: res.data.fastingTimeOverride ?? null });
            setStatus({ kind: 'saved' });
        } catch (error: unknown) {
            setStatus({ kind: 'error', message: apiError(error) });
        }
    };

    return (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <label htmlFor={selectId} className="font-medium text-gray-700">Fasting</label>
            <span className="text-xs text-gray-500">Healthians: {partner}</span>
            {item.fastingOverride && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Corrected</span>
            )}
            <select
                id={selectId}
                value={choice}
                onChange={(e) => { setChoice(e.target.value as Choice); setStatus(null); }}
                className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm bg-white"
            >
                <option value="partner">Use Healthians value</option>
                <option value="Not Required">Not required</option>
                <option value="Required">Required</option>
            </select>
            {choice === 'Required' && (
                <span className="flex items-center gap-1.5">
                    <input
                        type="number"
                        min={1}
                        max={MAX_FASTING_HOURS}
                        step={1}
                        inputMode="numeric"
                        aria-label={`Fasting hours for ${item.name}`}
                        aria-invalid={hoursInvalid}
                        value={hours}
                        onChange={(e) => { setHours(e.target.value); setStatus(null); }}
                        placeholder="hours"
                        className={`w-20 px-2 py-1.5 border rounded-lg text-sm ${hoursInvalid ? 'border-red-400' : 'border-gray-300'}`}
                    />
                    <span className="text-xs text-gray-500">hours (optional)</span>
                </span>
            )}
            <button
                onClick={save}
                disabled={!dirty || hoursInvalid || saving}
                aria-label={`Save fasting for ${item.name}`}
                className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {saving ? 'Saving...' : 'Save fasting'}
            </button>
            <span role="status" aria-live="polite" className="text-xs">
                {status?.kind === 'saved' && (
                    <span className="flex items-center gap-1 text-green-700"><Check className="h-3.5 w-3.5" /> Saved</span>
                )}
                {status?.kind === 'error' && <span className="text-red-600">{status.message}</span>}
                {hoursInvalid && <span className="text-red-600">Use a whole number from 1 to {MAX_FASTING_HOURS}</span>}
            </span>
        </div>
    );
}
