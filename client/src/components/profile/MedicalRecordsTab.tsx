'use client';
import { useEffect, useRef, useState } from 'react';
import { ExternalLink, FileText, Loader2, Trash2, Upload } from 'lucide-react';
import { ConfirmDialog } from '@/components/consult/ConfirmDialog';
import { Button } from '@/components/ui';
import { errorMessage, records } from '@/lib/consult/api';
import { RECORD_ACCESS_DAYS } from '@/lib/consult/consent';
import { formatIstDay } from '@/lib/consult/time';
import type { PatientDocument } from '@/lib/consult/types';
import { healthApi, isSelfPerson, type HealthPerson } from '@/lib/health';
import { cn } from '@/lib/utils';

const MAX_BYTES = 10 * 1024 * 1024;
const INLINE_IMAGE = ['image/jpeg', 'image/png', 'image/webp'];
const sizeLabel = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);

function sortPeople(list: HealthPerson[]) {
    return [...list].sort((a, b) => (isSelfPerson(a) === isSelfPerson(b) ? a.name.localeCompare(b.name) : isSelfPerson(a) ? -1 : 1));
}

/**
 * Old prescriptions, discharge summaries and outside lab reports, kept per person. A doctor sees
 * them only for a booking the patient chose to share their health record with.
 */
export function MedicalRecordsTab() {
    const [people, setPeople] = useState<HealthPerson[] | null>(null);
    const [personId, setPersonId] = useState<string | null>(null);
    const [docs, setDocs] = useState<PatientDocument[] | null>(null);
    const [max, setMax] = useState(50);
    const [error, setError] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const [removing, setRemoving] = useState<PatientDocument | null>(null);
    const input = useRef<HTMLInputElement>(null);
    // The person on screen now: an upload that finishes after a switch must not land in their list.
    const shown = useRef<string | null>(null);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                try { await healthApi.ensureSelf(); } catch { /* a thin profile can't make "Self" yet */ }
                const list = sortPeople(await healthApi.people());
                if (!alive) return;
                setPeople(list);
                setPersonId(list[0]?.id ?? null);
            } catch (e) {
                if (alive) setError(errorMessage(e));
            }
        })();
        return () => { alive = false; };
    }, []);

    useEffect(() => {
        shown.current = personId;
        if (!personId) return;
        let alive = true;
        setDocs(null);
        setError(null);
        records.list(personId)
            .then((r) => { if (alive) { setDocs(r.documents); setMax(r.max); } })
            .catch((e) => { if (alive) setError(errorMessage(e)); });
        return () => { alive = false; };
    }, [personId]);

    async function upload(files: FileList | null) {
        const file = files?.[0];
        if (input.current) input.current.value = '';
        if (!file || !personId) return;
        if (file.size > MAX_BYTES) {
            setError('Files can be up to 10 MB');
            return;
        }
        setUploading(true);
        setError(null);
        try {
            const doc = await records.upload(personId, file);
            if (shown.current === doc.patientId) setDocs((cur) => [doc, ...(cur ?? [])]);
        } catch (e) {
            setError(errorMessage(e, 'The file could not be uploaded. Please try again.'));
        } finally {
            setUploading(false);
        }
    }

    if (!people) {
        return error
            ? <p role="alert" className="py-8 text-center text-sm text-danger-ink">{error}</p>
            : <div className="flex justify-center py-12"><Loader2 className="animate-spin" aria-label="Loading medical records" /></div>;
    }
    const person = people.find((p) => p.id === personId);

    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-xl font-bold text-ink">Medical records</h2>
                <p className="text-sm text-ink-muted">
                    Keep old prescriptions, discharge summaries and outside lab reports here. A doctor sees them only when you tick
                    “Share health record” for a consultation, and only until {RECORD_ACCESS_DAYS} days after it.
                </p>
            </div>
            {people.length === 0 && <p className="py-8 text-center text-sm text-ink-muted">Complete your profile first, then add records here.</p>}
            {people.length > 1 && (
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Whose records">
                    {people.map((p) => (
                        <button
                            key={p.id}
                            type="button"
                            role="radio"
                            aria-checked={p.id === personId}
                            onClick={() => setPersonId(p.id)}
                            className={cn('max-w-full truncate rounded-full border px-3 py-1.5 text-sm font-semibold', p.id === personId ? 'border-primary bg-primary text-on-primary' : 'border-border bg-surface text-ink')}>
                            {isSelfPerson(p) ? `${p.name} (you)` : `${p.name} · ${p.relation}`}
                        </button>
                    ))}
                </div>
            )}
            {person && (
                <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm text-ink-muted">{docs ? `${docs.length} of ${max} files` : ' '}</p>
                        <input
                            ref={input}
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/heic,application/pdf,.heic"
                            className="sr-only"
                            id="medical-record-file"
                            onChange={(e) => void upload(e.target.files)}
                        />
                        <Button size="sm" loading={uploading} disabled={!docs || docs.length >= max} onClick={() => input.current?.click()}>
                            <Upload className="h-4 w-4" aria-hidden /> Upload photo or PDF
                        </Button>
                    </div>
                    {error && <p role="alert" className="text-sm font-semibold text-danger-ink">{error}</p>}
                    {!docs ? (
                        <div className="flex justify-center py-8"><Loader2 className="animate-spin" aria-label="Loading files" /></div>
                    ) : docs.length === 0 ? (
                        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-ink-muted">
                            No files yet for {isSelfPerson(person) ? 'you' : person.name}. Photos (JPEG, PNG, WebP, HEIC) or PDFs, up to 10 MB each.
                        </p>
                    ) : (
                        <ul className="space-y-2">
                            {docs.map((d) => (
                                <li key={d.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-surface p-3">
                                    {INLINE_IMAGE.includes(d.mimeType) ? (
                                        // Signed private-storage link; next/image would need it whitelisted.
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={d.url} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                                    ) : (
                                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-ink-subtle"><FileText className="h-6 w-6" aria-hidden /></span>
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-semibold text-ink">{d.name}</p>
                                        <p className="text-xs text-ink-muted">{formatIstDay(d.uploadedAt)} · {sizeLabel(d.sizeBytes)}</p>
                                    </div>
                                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-semibold text-primary hover:bg-surface-subtle" aria-label={`View ${d.name}`}>
                                        <ExternalLink className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">View</span>
                                    </a>
                                    <button type="button" onClick={() => setRemoving(d)} className="inline-flex shrink-0 items-center rounded-lg px-2 py-1.5 text-danger-ink hover:bg-surface-subtle" aria-label={`Delete ${d.name}`}>
                                        <Trash2 className="h-4 w-4" aria-hidden />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            )}
            <ConfirmDialog
                open={removing !== null}
                title="Delete this file?"
                description={removing ? `“${removing.name}” is deleted for good. Doctors you shared your record with can no longer open it.` : ''}
                confirmLabel="Delete"
                destructive
                onClose={() => setRemoving(null)}
                onConfirm={async () => {
                    if (!removing) return;
                    await records.remove(removing.id);
                    setDocs((cur) => cur?.filter((x) => x.id !== removing.id) ?? cur);
                    setRemoving(null);
                }}
            />
        </div>
    );
}
