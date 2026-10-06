'use client';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { doctor as doctorApi, errorMessage } from '@/lib/consult/api';
import { SLOT_OPTIONS, validateWeek, windowsToForm, type WeekForm } from '@/lib/consult/availability';
import { WEEKDAYS } from '@/lib/consult/time';
import type { DoctorMe } from '@/lib/consult/types';
import { useDoctor } from './DoctorContext';

const timeClass = 'h-11 w-24 rounded-xl border border-border bg-white px-3 text-center text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

export function WeeklyHours() {
    const { doctor, setDoctor } = useDoctor();
    const [week, setWeek] = useState<WeekForm>(() => windowsToForm(doctor.availability));
    const [slotMinutes, setSlotMinutes] = useState(doctor.slotMinutes);
    const [dayErrors, setDayErrors] = useState<Record<number, string>>({});
    const [formError, setFormError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);
    const [busy, setBusy] = useState(false);

    const edit = (fn: (draft: WeekForm) => void) => {
        setWeek((prev) => {
            const next = prev.map((d) => d.map((r) => ({ ...r })));
            fn(next);
            return next;
        });
        setSaved(false);
    };

    const save = async () => {
        setFormError(null);
        setSaved(false);
        const { errors, windows } = validateWeek(week);
        setDayErrors(errors);
        if (Object.keys(errors).length) return;
        setBusy(true);
        try {
            const result = await doctorApi.setAvailability(windows, slotMinutes);
            setDoctor({ ...doctor, availability: result, slotMinutes } as DoctorMe);
            setWeek(windowsToForm(result));
            setSaved(true);
        } catch (e) {
            setFormError(errorMessage(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-4">
            <Card className="p-5">
                <label htmlFor="slotMinutes" className="mb-1 block text-sm font-semibold">Length of each appointment</label>
                <select id="slotMinutes" value={slotMinutes} onChange={(e) => { setSlotMinutes(Number(e.target.value)); setSaved(false); }}
                    className="h-11 w-full max-w-xs rounded-xl border border-border bg-white px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
                    {SLOT_OPTIONS.map((m) => <option key={m} value={m}>{m} minutes</option>)}
                </select>
                <p className="mt-2 text-xs text-muted-foreground">Times are in Indian time, written as 24-hour clock, for example 09:30 or 17:00.</p>
            </Card>

            {WEEKDAYS.map((name, day) => (
                <Card key={name} className="p-5">
                    <div className="flex items-center justify-between gap-3">
                        <h2 className="font-bold text-foreground">{name}</h2>
                        <Button variant="outline" size="sm" type="button" aria-label={`Add hours on ${name}`}
                            onClick={() => edit((d) => d[day].push({ start: '09:00', end: '17:00' }))}>
                            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> Add hours
                        </Button>
                    </div>
                    {week[day].length === 0 && <p className="mt-2 text-sm text-muted-foreground">Not available</p>}
                    <ul className="mt-3 space-y-2">
                        {week[day].map((r, i) => (
                            <li key={i} className="flex flex-wrap items-center gap-2">
                                <input aria-label={`${name} start time, window ${i + 1}`} inputMode="numeric" placeholder="09:00" value={r.start}
                                    className={timeClass} onChange={(e) => edit((d) => { d[day][i].start = e.target.value; })} />
                                <span aria-hidden className="text-muted-foreground">to</span>
                                <input aria-label={`${name} end time, window ${i + 1}`} inputMode="numeric" placeholder="17:00" value={r.end}
                                    className={timeClass} onChange={(e) => edit((d) => { d[day][i].end = e.target.value; })} />
                                <button type="button" aria-label={`Remove window ${i + 1} on ${name}`}
                                    className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-red-50 hover:text-destructive"
                                    onClick={() => edit((d) => { d[day].splice(i, 1); })}>
                                    <Trash2 className="h-4 w-4" aria-hidden />
                                </button>
                            </li>
                        ))}
                    </ul>
                    {dayErrors[day] && <p role="alert" className="mt-2 text-sm font-medium text-destructive">{dayErrors[day]}</p>}
                </Card>
            ))}

            {formError && <div role="alert" className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-destructive">{formError}</div>}
            {saved && <div role="status" className="rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-700">Your hours are saved.</div>}
            <Button size="lg" className="w-full sm:w-auto" onClick={save} disabled={busy}>{busy ? 'Saving...' : 'Save hours'}</Button>
        </div>
    );
}
