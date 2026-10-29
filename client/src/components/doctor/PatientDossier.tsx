'use client';
import { AlertTriangle, FileText, HeartPulse, Pill, Users } from 'lucide-react';
import { Card } from '@/components/ui';
import { getApiUrl } from '@/lib/api';
import { formatIstDay } from '@/lib/consult/time';
import type { DoctorConsultationRecord } from '@/lib/consult/types';

function Chips({ items, tone }: { items: string[]; tone: 'warn' | 'plain' }) {
    return (
        <div className="flex flex-wrap gap-1.5">
            {items.map((x) => (
                <span key={x} className={tone === 'warn' ? 'rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-800' : 'rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-800'}>
                    {x}
                </span>
            ))}
        </div>
    );
}

/** The family intake, as the doctor needs it before and during the call. */
export function PatientDossier({ record }: { record: DoctorConsultationRecord }) {
    const p = record.patient;
    const conditions = p.chronicConditions ?? [];
    const allergies = p.allergies ?? [];
    const medicines = p.currentMedications ?? [];
    const reports = record.attachedReports ?? [];
    const empty = !conditions.length && !allergies.length && !medicines.length && !reports.length && !p.bloodGroup && !record.caregiver;
    if (empty) return null;

    return (
        <Card className="space-y-4 p-5">
            <h2 className="text-base font-bold text-foreground">Patient dossier</h2>
            {record.caregiver && (
                <p className="flex items-start gap-2 rounded-xl bg-[#F4F0FA] px-3 py-2 text-sm text-foreground">
                    <Users className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                    <span>
                        Booked by <b>{record.caregiver.name}</b> (patient is their {record.caregiver.relation.toLowerCase()}).{' '}
                        {record.caregiver.joinedAt ? 'They are in the call to assist.' : record.caregiver.coJoining ? 'They plan to join the call to assist.' : 'They are not joining the call.'}
                        {p.preferredLanguage === 'hi' ? ' Patient prefers Hindi.' : ''}
                    </span>
                </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                    <p className="flex items-center gap-1.5 text-xs font-bold uppercase text-muted-foreground"><HeartPulse className="h-3.5 w-3.5" aria-hidden /> Conditions</p>
                    {conditions.length ? <Chips items={conditions} tone="plain" /> : <p className="text-sm text-muted-foreground">None recorded</p>}
                    {p.bloodGroup && <p className="text-sm text-foreground">Blood group <b>{p.bloodGroup}</b></p>}
                </div>
                <div className="space-y-1.5">
                    <p className="flex items-center gap-1.5 text-xs font-bold uppercase text-red-700"><AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Allergies</p>
                    {allergies.length ? <Chips items={allergies} tone="warn" /> : <p className="text-sm text-muted-foreground">None recorded. Confirm verbally before prescribing.</p>}
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                    <p className="flex items-center gap-1.5 text-xs font-bold uppercase text-muted-foreground"><Pill className="h-3.5 w-3.5" aria-hidden /> Current medicines</p>
                    {medicines.length ? <Chips items={medicines} tone="plain" /> : <p className="text-sm text-muted-foreground">None recorded</p>}
                </div>
            </div>
            {reports.length > 0 && (
                <div className="space-y-1.5">
                    <p className="flex items-center gap-1.5 text-xs font-bold uppercase text-muted-foreground"><FileText className="h-3.5 w-3.5" aria-hidden /> Shared reports</p>
                    <ul className="space-y-1">
                        {reports.map((r) => (
                            <li key={r.id}>
                                <a href={getApiUrl(`/reports/public/${r.viewToken}`)} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-primary underline-offset-2 hover:underline">
                                    {r.label} · {formatIstDay(r.date)}{r.isFullReport ? '' : ' (partial)'}
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </Card>
    );
}
