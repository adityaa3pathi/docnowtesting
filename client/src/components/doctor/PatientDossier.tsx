'use client';
import { useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, ExternalLink, FileText, HeartPulse, Image as ImageIcon, Pill, Users } from 'lucide-react';
import { Card } from '@/components/ui';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getApiUrl } from '@/lib/api';
import { formatIstDay } from '@/lib/consult/time';
import type { ConsultAttachment, DoctorConsultationRecord } from '@/lib/consult/types';

/** Browsers can draw these inline; HEIC (iPhone) and PDFs open in their own viewer instead. */
const INLINE_IMAGE = ['image/jpeg', 'image/png', 'image/webp'];
const isInlineImage = (a: ConsultAttachment) => INLINE_IMAGE.includes(a.mimeType);
const sizeLabel = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);

/** Thumbnails of the uploaded records; a click opens a large preview, with previous / next. */
export function AttachedDocuments({ attachments }: { attachments: ConsultAttachment[] }) {
    const [open, setOpen] = useState<number | null>(null);
    const current = open === null ? null : attachments[open] ?? null;
    const go = (step: number) => setOpen((i) => (i === null ? i : (i + step + attachments.length) % attachments.length));

    return (
        <div className="space-y-1.5">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase text-muted-foreground"><ImageIcon className="h-3.5 w-3.5" aria-hidden /> Attached documents</p>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {attachments.map((a, i) => (
                    <li key={a.id}>
                        <button
                            type="button"
                            onClick={() => setOpen(i)}
                            aria-label={`Open ${a.name}`}
                            className="group flex w-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                            {isInlineImage(a) ? (
                                // Signed S3 links on any host; next/image would need them whitelisted.
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={a.url} alt="" className="aspect-square w-full object-cover transition group-hover:opacity-90" />
                            ) : (
                                <span className="flex aspect-square w-full items-center justify-center bg-gray-50 text-gray-500">
                                    <FileText className="h-8 w-8" aria-hidden />
                                </span>
                            )}
                            <span className="truncate px-2 py-1 text-xs font-semibold text-foreground">{a.name}</span>
                        </button>
                    </li>
                ))}
            </ul>
            <Dialog open={current !== null} onOpenChange={(o) => !o && setOpen(null)}>
                {current && (
                    <DialogContent className="max-w-4xl">
                        <DialogHeader>
                            <DialogTitle>{current.name}</DialogTitle>
                            <DialogDescription>
                                Uploaded {formatIstDay(current.uploadedAt)} · {sizeLabel(current.sizeBytes)}
                                {attachments.length > 1 ? ` · ${(open ?? 0) + 1} of ${attachments.length}` : ''}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="flex max-h-[75vh] min-h-[40vh] items-center justify-center overflow-auto rounded-xl bg-gray-900">
                            {isInlineImage(current) ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={current.url} alt={current.name} className="max-h-[75vh] w-auto object-contain" data-testid="attachment-preview" />
                            ) : current.mimeType === 'application/pdf' ? (
                                <iframe src={current.url} title={current.name} className="h-[75vh] w-full bg-white" data-testid="attachment-preview" />
                            ) : (
                                <p className="p-6 text-center text-sm text-white" data-testid="attachment-preview">
                                    This photo format cannot be shown here. Use “Open in new tab”.
                                </p>
                            )}
                        </div>
                        <div className="flex items-center justify-between gap-2">
                            {attachments.length > 1 ? (
                                <div className="flex gap-2">
                                    <button type="button" onClick={() => go(-1)} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm font-semibold" aria-label="Previous document">
                                        <ChevronLeft className="h-4 w-4" aria-hidden /> Previous
                                    </button>
                                    <button type="button" onClick={() => go(1)} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm font-semibold" aria-label="Next document">
                                        Next <ChevronRight className="h-4 w-4" aria-hidden />
                                    </button>
                                </div>
                            ) : <span />}
                            <a href={current.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-primary">
                                Open in new tab <ExternalLink className="h-4 w-4" aria-hidden />
                            </a>
                        </div>
                    </DialogContent>
                )}
            </Dialog>
        </div>
    );
}

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
    const documents = record.attachments ?? [];
    const empty = !conditions.length && !allergies.length && !medicines.length && !reports.length && !documents.length && !p.bloodGroup && !record.caregiver;
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
            {documents.length > 0 && <AttachedDocuments attachments={documents} />}
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
