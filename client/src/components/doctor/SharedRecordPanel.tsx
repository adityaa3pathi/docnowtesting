'use client';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Activity, Eye, ExternalLink, FileText, FlaskConical, FolderOpen, History, Loader2, Lock, RefreshCw, Stethoscope } from 'lucide-react';
import { Card } from '@/components/ui';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PrescriptionView } from '@/components/consult/PrescriptionView';
import { RecordVitalsSection } from '@/components/vitals/RecordVitalsSection';
import { getApiUrl } from '@/lib/api';
import { doctor as doctorApi, errorMessage } from '@/lib/consult/api';
import { formatIstDateTime, formatIstDay } from '@/lib/consult/time';
import type { SharedFile, SharedItemKind, SharedPastConsultation, SharedRecord } from '@/lib/consult/types';

type Tab = 'reports' | 'visits' | 'files' | 'vitals';
type Preview = { name: string; mimeType: string; url: string };

const INLINE_IMAGE = ['image/jpeg', 'image/png', 'image/webp'];
const sizeLabel = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);

export function closedMessage(r: Extract<SharedRecord, { shared: false }>): string {
    if (r.reason === 'NOT_SHARED') return 'The patient has not shared their full DocNow health record for this consultation. You can see what they attached above.';
    if (r.reason === 'ENDED') return `Access to this health record ended on ${formatIstDay(r.until)}.`;
    return 'The health record opens once the consultation is paid, and closes if it is cancelled.';
}

function FileButton({ file, busy, onOpen }: { file: SharedFile; busy: boolean; onOpen: () => void }) {
    return (
        <button
            type="button"
            onClick={onOpen}
            disabled={busy}
            className="flex w-full min-w-0 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-left text-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden /> : <FileText className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />}
            <span className="min-w-0 flex-1 truncate font-semibold text-foreground">{file.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{formatIstDay(file.uploadedAt)} · {sizeLabel(file.sizeBytes)}</span>
        </button>
    );
}

function PastVisit({ visit, opening, open }: { visit: SharedPastConsultation; opening: string | null; open: (kind: SharedItemKind, id: string) => void }) {
    const n = visit.note;
    const lines = n ? ([['Complaints', n.complaints], ['Findings', n.findings], ['Diagnosis', n.diagnosis], ['Advice', n.advice]] as const).filter(([, v]) => !!v) : [];
    return (
        <details className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm">
            <summary className="cursor-pointer list-none">
                <span className="font-semibold text-foreground">{formatIstDay(visit.startsAt)} · {visit.doctorName}</span>
                <span className="block text-xs text-muted-foreground">
                    {visit.specialty}{n?.diagnosis ? ` · ${n.diagnosis}` : ''}
                </span>
            </summary>
            <div className="mt-3 space-y-3">
                {lines.length > 0 ? (
                    <dl className="space-y-1">
                        {lines.map(([k, v]) => (
                            <div key={k}><dt className="inline font-semibold text-foreground">{k}: </dt><dd className="inline whitespace-pre-line text-foreground">{v}</dd></div>
                        ))}
                        {n?.followUpDays ? <p className="text-muted-foreground">Follow-up advised in {n.followUpDays} days</p> : null}
                    </dl>
                ) : <p className="text-muted-foreground">No notes were written.</p>}
                {visit.prescription ? <PrescriptionView prescription={visit.prescription} /> : <p className="text-muted-foreground">No prescription.</p>}
                {visit.attachments.length > 0 && (
                    <div className="space-y-1.5">
                        <p className="text-xs font-bold uppercase text-muted-foreground">Attached by the patient</p>
                        {visit.attachments.map((f) => (
                            <FileButton key={f.id} file={f} busy={opening === f.id} onOpen={() => open('attachments', f.id)} />
                        ))}
                    </div>
                )}
            </div>
        </details>
    );
}

/**
 * The patient's whole DocNow record, when they shared it for this booking: lab reports, past
 * consultations (any doctor) and their medical files. Every look is logged on the server and the
 * patient sees when the doctor last opened it, so nothing loads until the doctor asks, and files are
 * fetched one at a time on click, never as thumbnails.
 */
export function SharedRecordPanel({ consultationId }: { consultationId: string }) {
    const [record, setRecord] = useState<SharedRecord | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const latest = useRef(0);
    const refetch = useCallback(async () => {
        const mine = ++latest.current;
        setLoading(true);
        setError(null);
        try {
            const r = await doctorApi.sharedRecord(consultationId);
            if (mine === latest.current) setRecord(r);
        } catch (e) {
            if (mine === latest.current) setError(errorMessage(e, 'The health record could not be loaded.'));
        } finally {
            if (mine === latest.current) setLoading(false);
        }
    }, [consultationId]);
    const [tab, setTab] = useState<Tab>('reports');
    const [opening, setOpening] = useState<string | null>(null);
    const [openError, setOpenError] = useState<string | null>(null);
    const [preview, setPreview] = useState<Preview | null>(null);

    async function open(kind: SharedItemKind, id: string) {
        setOpening(id);
        setOpenError(null);
        // Reports open in a new tab; the tab is made now, inside the click, so pop-up blockers allow it.
        const win = kind === 'reports' ? window.open('', '_blank') : null;
        try {
            const link = await doctorApi.openSharedItem(consultationId, kind, id);
            if (link.kind === 'report') {
                const url = getApiUrl(`/reports/public/${link.viewToken}`);
                if (win) {
                    win.opener = null;
                    win.location.href = url;
                } else setPreview({ name: 'Lab report', mimeType: 'application/pdf', url });
            } else setPreview({ name: link.name, mimeType: link.mimeType, url: link.url });
        } catch (e) {
            win?.close();
            setOpenError(errorMessage(e, 'This file could not be opened. Please try again.'));
        } finally {
            setOpening(null);
        }
    }

    const header = (
        <div className="flex items-start justify-between gap-2">
            <h2 className="flex items-center gap-2 text-base font-bold text-foreground"><History className="h-4 w-4 text-primary" aria-hidden /> Health record</h2>
            {(record || error) && (
                <button type="button" onClick={() => void refetch()} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-primary hover:bg-gray-50" aria-label="Refresh health record">
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Refresh
                </button>
            )}
        </div>
    );

    if (!record && !loading && !error) {
        return (
            <Card className="space-y-3 p-5" data-testid="shared-record">
                {header}
                <p className="text-sm text-muted-foreground">Lab reports, earlier consultations, files and vitals, if the patient shared them for this booking. The patient can see when you opened it.</p>
                <button type="button" onClick={() => void refetch()} className="inline-flex items-center gap-2 rounded-xl border border-primary px-3 py-2 text-sm font-semibold text-primary hover:bg-gray-50">
                    <Eye className="h-4 w-4" aria-hidden /> Open health record
                </button>
            </Card>
        );
    }
    if (loading && !record) {
        return <Card className="space-y-3 p-5">{header}<p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading</p></Card>;
    }
    if (!record) {
        return <Card className="space-y-3 p-5">{header}<p role="alert" className="text-sm text-destructive">{error ?? 'The health record could not be loaded.'}</p></Card>;
    }
    if (!record.shared) {
        return (
            <Card className="space-y-3 p-5" data-testid="shared-record">
                {header}
                <p className="flex items-start gap-2 rounded-xl bg-gray-50 px-3 py-2 text-sm text-muted-foreground"><Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {closedMessage(record)}</p>
            </Card>
        );
    }

    const tabs: { id: Tab; label: string; count: number; icon: ReactNode }[] = [
        { id: 'reports', label: 'Lab reports', count: record.reports.length, icon: <FlaskConical className="h-4 w-4" aria-hidden /> },
        { id: 'visits', label: 'Past visits', count: record.consultations.length, icon: <Stethoscope className="h-4 w-4" aria-hidden /> },
        { id: 'files', label: 'Files', count: record.documents.length, icon: <FolderOpen className="h-4 w-4" aria-hidden /> },
        // P8: older servers leave vitals out.
        ...(record.vitals
            ? [{ id: 'vitals' as const, label: 'Vitals', count: record.vitals.bp.length + record.vitals.sugar.length + record.vitals.periods.length, icon: <Activity className="h-4 w-4" aria-hidden /> }]
            : []),
    ];

    return (
        <Card className="space-y-3 p-5" data-testid="shared-record">
            {header}
            <p className="text-xs text-muted-foreground">Shared by the patient until {formatIstDateTime(record.until)}. Each file you open is recorded.</p>
            <div role="tablist" aria-label="Health record" className={`grid gap-1 rounded-xl bg-gray-100 p-1 ${tabs.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
                {tabs.map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={tab === t.id}
                        onClick={() => setTab(t.id)}
                        className={`flex min-w-0 items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-xs font-semibold sm:text-sm ${tab === t.id ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground'}`}>
                        <span className="hidden sm:inline">{t.icon}</span>
                        <span className="truncate">{t.label}</span>
                        <span className="shrink-0">({t.count})</span>
                    </button>
                ))}
            </div>
            {record.vitals === null && <p className="text-xs text-muted-foreground">Vitals are not included: the patient agreed to sharing before vitals were part of it.</p>}
            {openError && <p role="alert" className="text-sm font-semibold text-destructive">{openError}</p>}
            <div role="tabpanel" className="space-y-2">
                {tab === 'reports' && (record.reports.length === 0 ? <p className="text-sm text-muted-foreground">No DocNow lab reports yet.</p> : record.reports.map((r) => (
                    <button
                        key={r.id}
                        type="button"
                        disabled={opening === r.id}
                        onClick={() => void open('reports', r.id)}
                        className="flex w-full min-w-0 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-left text-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60">
                        {opening === r.id ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden /> : <FlaskConical className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />}
                        <span className="min-w-0 flex-1 truncate font-semibold text-foreground">{r.label}{r.isFullReport ? '' : ' (partial)'}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{formatIstDay(r.date)}</span>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
                    </button>
                )))}
                {tab === 'visits' && (record.consultations.length === 0 ? <p className="text-sm text-muted-foreground">No earlier DocNow consultations.</p> : record.consultations.map((v) => (
                    <PastVisit key={v.id} visit={v} opening={opening} open={(k, id) => void open(k, id)} />
                )))}
                {tab === 'files' && (record.documents.length === 0 ? <p className="text-sm text-muted-foreground">The patient has not uploaded any medical files.</p> : record.documents.map((f) => (
                    <FileButton key={f.id} file={f} busy={opening === f.id} onOpen={() => void open('documents', f.id)} />
                )))}
                {tab === 'vitals' && <RecordVitalsSection vitals={record.vitals} />}
            </div>
            <Dialog open={preview !== null} onOpenChange={(o) => !o && setPreview(null)}>
                {preview && (
                    <DialogContent className="max-w-4xl">
                        <DialogHeader>
                            <DialogTitle className="break-all">{preview.name}</DialogTitle>
                            <DialogDescription>From the patient&apos;s health record. The link works for 10 minutes.</DialogDescription>
                        </DialogHeader>
                        <div className="flex max-h-[75vh] min-h-[40vh] items-center justify-center overflow-auto rounded-xl bg-gray-900">
                            {INLINE_IMAGE.includes(preview.mimeType) ? (
                                // Signed private-storage links; next/image would need them whitelisted.
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={preview.url} alt={preview.name} className="max-h-[75vh] w-auto object-contain" data-testid="record-preview" />
                            ) : preview.mimeType === 'application/pdf' ? (
                                <iframe src={preview.url} title={preview.name} className="h-[75vh] w-full bg-white" data-testid="record-preview" />
                            ) : (
                                <p className="p-6 text-center text-sm text-white" data-testid="record-preview">This photo format cannot be shown here. Use “Open in new tab”.</p>
                            )}
                        </div>
                        <a href={preview.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 self-end text-sm font-semibold text-primary">
                            Open in new tab <ExternalLink className="h-4 w-4" aria-hidden />
                        </a>
                    </DialogContent>
                )}
            </Dialog>
        </Card>
    );
}
