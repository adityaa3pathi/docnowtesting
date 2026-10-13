'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { Download, Loader2 } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { Badge } from '@/components/consult/Badge';
import { ConfirmDialog } from '@/components/consult/ConfirmDialog';
import { JoinPanel } from '@/components/consult/JoinPanel';
import { PrescriptionView } from '@/components/consult/PrescriptionView';
import { ErrorState, LoadingBlock } from '@/components/consult/States';
import { useDoctor } from '@/components/doctor/DoctorContext';
import { NotesForm } from '@/components/doctor/NotesForm';
import { PrescriptionBuilder } from '@/components/doctor/PrescriptionBuilder';
import { useApi } from '@/hooks/useApi';
import { doctor as doctorApi, errorMessage } from '@/lib/consult/api';
import { statusInfo } from '@/lib/consult/status';
import { formatIstDateTime, formatIstTime } from '@/lib/consult/time';
import type { DoctorConsultationRecord } from '@/lib/consult/types';

const WRITABLE = ['IN_PROGRESS', 'COMPLETED'];

function notesLock(record: DoctorConsultationRecord): string | null {
    if (record.prescription) return 'Notes are locked because the prescription has been issued.';
    if (!WRITABLE.includes(record.status)) return 'Notes open once the call has started.';
    return null;
}

function IssuedPrescription({ record }: { record: DoctorConsultationRecord & { prescription: NonNullable<DoctorConsultationRecord['prescription']> } }) {
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
            <h2 className="font-bold text-foreground">Prescription issued</h2>
            <PrescriptionView prescription={record.prescription} />
            <Button variant="outline" className="w-full" disabled={busy} onClick={() => void download()}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Download className="mr-2 h-4 w-4" aria-hidden />}
                Download prescription (PDF)
            </Button>
            {error && <p role="alert" className="text-sm font-semibold text-destructive">{error}</p>}
        </section>
    );
}

export default function DoctorConsultationRoomPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const { doctor } = useDoctor();
    const { data: record, error, loading, refetch, setData } = useApi(() => doctorApi.consultation(id), [id]);
    const [ending, setEnding] = useState(false);
    // Bumped after ending, so the call panel remounts and its cleanup leaves the room.
    const [callKey, setCallKey] = useState(0);

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
                            <Badge tone={info.tone}>{info.label}</Badge>
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
                        userName={doctor.displayName}
                        otherParty="patient"
                        join={() => doctorApi.join(record.id)}
                        onChange={() => void refetch()}
                    />
                    {record.status === 'IN_PROGRESS' && (
                        <Button variant="outline" className="w-full border-destructive text-destructive" onClick={() => setEnding(true)}>
                            End consultation
                        </Button>
                    )}
                </div>
                <div className="space-y-4">
                    <NotesForm key={record.id} consultationId={record.id} note={record.note} lockedReason={notesLock(record)} />
                    {record.prescription ? (
                        <IssuedPrescription record={{ ...record, prescription: record.prescription }} />
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
                    await refetch();
                }}
            />
        </div>
    );
}
