'use client';
import { use } from 'react';
import Link from 'next/link';
import { ChevronRight, FileText } from 'lucide-react';
import { Card } from '@/components/ui';
import { Badge } from '@/components/consult/Badge';
import { ErrorState, LoadingBlock } from '@/components/consult/States';
import { useApi } from '@/hooks/useApi';
import { doctor as doctorApi } from '@/lib/consult/api';
import { statusInfo } from '@/lib/consult/status';
import { formatIstDateTime } from '@/lib/consult/time';

const TYPE_LABEL = { VIDEO: 'Video', AUDIO: 'Audio', CHAT: 'Chat' } as const;

/** One patient: this doctor's own visits with them, each linking to the consultation. */
export default function DoctorPatientPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const { data, error, loading, refetch } = useApi(() => doctorApi.patient(id), [id]);

    if (loading && !data) return <LoadingBlock label="Loading patient" />;
    if (!data) return <ErrorState message={error ?? 'We could not load this patient.'} onRetry={refetch} />;

    return (
        <div className="space-y-4">
            <Link href="/doctor/patients" className="text-sm font-semibold text-primary">&larr; Patients</Link>
            <Card className="space-y-1 p-5">
                <h1 className="text-xl font-bold text-foreground">{data.patient.name}</h1>
                <p className="text-sm text-muted-foreground">{data.patient.age} years · {data.patient.gender}</p>
                <p className="text-xs text-muted-foreground">Your visits only. Their full DocNow record opens from a booking they shared it for.</p>
            </Card>
            <h2 className="text-base font-bold text-foreground">Your visits ({data.visits.length})</h2>
            <ul className="space-y-2">
                {data.visits.map((v) => {
                    const info = statusInfo(v.status);
                    return (
                        <li key={v.id}>
                            <Link href={`/doctor/consultations/${v.id}`} className="flex items-start justify-between gap-3 rounded-2xl border border-border bg-white p-4 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                                <div className="min-w-0 space-y-0.5">
                                    <p className="font-semibold text-foreground">{formatIstDateTime(v.startsAt)}</p>
                                    <p className="text-xs text-muted-foreground">{TYPE_LABEL[v.type]} consultation</p>
                                    {v.diagnosis && <p className="text-sm text-foreground"><b>Diagnosis:</b> {v.diagnosis}</p>}
                                    {!v.diagnosis && v.complaints && <p className="text-sm text-foreground"><b>Complaints:</b> {v.complaints}</p>}
                                    {v.prescription && <p className="flex items-center gap-1 text-xs font-semibold text-primary"><FileText className="h-3.5 w-3.5" aria-hidden /> Prescription v{v.prescription.version}</p>}
                                    {v.followUpDays ? <p className="text-xs text-muted-foreground">Follow-up advised in {v.followUpDays} days</p> : null}
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                    <Badge tone={info.tone}>{info.label}</Badge>
                                    <ChevronRight className="h-5 w-5 text-muted-foreground" aria-hidden />
                                </div>
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
