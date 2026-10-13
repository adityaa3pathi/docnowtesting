'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, Loader2 } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { Badge } from '@/components/consult/Badge';
import { ConfirmDialog } from '@/components/consult/ConfirmDialog';
import { JoinPanel } from '@/components/consult/JoinPanel';
import { PrescriptionView } from '@/components/consult/PrescriptionView';
import { ErrorState, LoadingBlock } from '@/components/consult/States';
import { NotesForm } from '@/components/doctor/NotesForm';
import { PrescriptionBuilder } from '@/components/doctor/PrescriptionBuilder';
import { useApi } from '@/hooks/useApi';
import { doctor as doctorApi, errorMessage } from '@/lib/consult/api';
import { shouldWatchForPatient } from '@/lib/consult/room';
import { statusInfo } from '@/lib/consult/status';
import { formatIstDateTime, formatIstTime } from '@/lib/consult/time';
import type { DoctorConsultationRecord, Prescription } from '@/lib/consult/types';

const WRITABLE = ['IN_PROGRESS', 'COMPLETED'];
const WATCH_MS = 10_000;

function notesLock(record: DoctorConsultationRecord): string | null {
    if (record.prescription) return 'Notes are locked because the prescription has been issued.';
    if (!WRITABLE.includes(record.status)) return 'Notes open once the call has started.';
    return null;
}

function EarlierVersions({ versions }: { versions: DoctorConsultationRecord['previousVersions'] }) {
    if (versions.length === 0) return null;
    return (
        <details className="rounded-xl bg-gray-50 px-3 py-2 text-sm">
            <summary className="cursor-pointer font-semibold text-foreground">Earlier versions ({versions.length})</summary>
            <ul className="mt-2 space-y-2">
                {versions.map((v) => (
                    <li key={v.id} className="text-muted-foreground">
                        <p className="font-semibold text-foreground">Version {v.version}</p>
                        <p>Issued {formatIstDateTime(v.issuedAt)} · Voided {formatIstDateTime(v.voidedAt)}</p>
                        {v.voidReason && <p>Reason: {v.voidReason}</p>}
                    </li>
                ))}
            </ul>
        </details>
    );
}

function IssuedPrescription({ record, prescription, onCorrect }: { record: DoctorConsultationRecord; prescription: Prescription; onCorrect: () => void }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function download() {
        setBusy(true);
        setError(null);
        try {
            await doctorApi.downloadPrescription(record.id);
        } catch (e) {
            setError(errorMessage(e, e instanceof Error ? e.message : undefined));
        } finally {
            setBusy(false);
        }
    }

    return (
        <section aria-label="Issued prescription" className="space-y-3 rounded-2xl border border-border bg-white p-4">
            <div className="flex items-center justify-between gap-2">
                <h2 className="font-bold text-foreground">Prescription issued</h2>
                <Badge tone="info">Version {prescription.version}</Badge>
            </div>
            <PrescriptionView prescription={prescription} />
            <Button variant="outline" className="w-full" disabled={busy} onClick={() => void download()}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Download className="mr-2 h-4 w-4" aria-hidden />}
                Download prescription (PDF)
            </Button>
            <Button variant="ghost" className="w-full" onClick={onCorrect}>Correct prescription</Button>
            {error && <p role="alert" className="text-sm font-semibold text-destructive">{error}</p>}
            <EarlierVersions versions={record.previousVersions} />
        </section>
    );
}

export default function DoctorConsultationRoomPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const { data: record, error, loading, refetch, setData } = useApi(() => doctorApi.consultation(id), [id]);
    const [ending, setEnding] = useState(false);
    // Bumped after ending, so the call panel remounts and its cleanup leaves the room.
    const [callKey, setCallKey] = useState(0);
    const [inCall, setInCall] = useState(false);
    const [correcting, setCorrecting] = useState(false);
    const watching = !!record && shouldWatchForPatient(record.status, inCall);

    // Re-checks so the doctor sees the patient arrive; skips ticks while the tab is hidden.
    useEffect(() => {
        if (!watching) return;
        const t = setInterval(() => {
            if (document.visibilityState === 'visible') void refetch();
        }, WATCH_MS);
        return () => clearInterval(t);
    }, [watching, refetch]);

    if (loading && !record) return <LoadingBlock label="Loading consultation" />;
    if (!record) return <ErrorState message={error ?? 'We could not load this consultation.'} onRetry={refetch} />;

    const info = statusInfo(record.status);
    const { patient } = record;

    return (
        <div className="space-y-4">
            <Link href="/doctor/consultations" className="text-sm font-semibold text-primary">&larr; Consultations</Link>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
                <div className="space-y-4">
                    <Card className="space-y-1 p-5">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                            <h1 className="text-xl font-bold text-foreground">{patient.name}</h1>
                            <div className="flex flex-wrap gap-2">
                                {watching && record.patientJoinedAt && (
                                    <Badge tone="success" className="animate-pulse motion-reduce:animate-none">Patient is waiting</Badge>
                                )}
                                <Badge tone={info.tone}>{info.label}</Badge>
                            </div>
                        </div>
                        <p className="text-sm text-muted-foreground">{patient.age} years · {patient.gender}</p>
                        <p className="text-sm font-semibold text-foreground">
                            {formatIstDateTime(record.startsAt)} to {formatIstTime(record.slot.endsAt)} (Indian time)
                        </p>
                    </Card>
                    <JoinPanel
                        key={callKey}
                        status={record.status}
                        type={record.type}
                        startsAt={record.startsAt}
                        endsAt={record.slot.endsAt}
                        otherParty="patient"
                        join={() => doctorApi.join(record.id)}
                        onChange={() => void refetch()}
                        onCallChange={setInCall}
                    />
                    {record.status === 'IN_PROGRESS' && (
                        <Button variant="outline" className="w-full border-destructive text-destructive" onClick={() => setEnding(true)}>
                            End consultation
                        </Button>
                    )}
                </div>
                <div className="space-y-4">
                    <NotesForm key={record.id} consultationId={record.id} note={record.note} lockedReason={notesLock(record)} />
                    {record.prescription && correcting ? (
                        <PrescriptionBuilder
                            key={record.prescription.id}
                            consultationId={record.id}
                            correcting={record.prescription}
                            onCancel={() => setCorrecting(false)}
                            onIssued={() => {
                                setCorrecting(false);
                                void refetch();
                            }}
                        />
                    ) : record.prescription ? (
                        <IssuedPrescription record={record} prescription={record.prescription} onCorrect={() => setCorrecting(true)} />
                    ) : WRITABLE.includes(record.status) && (
                        <PrescriptionBuilder consultationId={record.id} onIssued={(p) => setData({ ...record, prescription: p })} />
                    )}
                </div>
            </div>
            <ConfirmDialog
                open={ending}
                title="End this consultation?"
                description="The call is marked as finished and cannot be joined again. You can still write notes and issue the prescription afterwards."
                confirmLabel="End consultation"
                destructive
                onClose={() => setEnding(false)}
                onConfirm={async () => {
                    await doctorApi.end(record.id);
                    setCallKey((k) => k + 1);
                    setInCall(false);
                    await refetch();
                }}
            />
        </div>
    );
}
