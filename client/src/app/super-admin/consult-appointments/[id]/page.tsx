'use client';
import { use } from 'react';
import { PageHeader } from '@/components/admin/consult/shared';
import { Badge } from '@/components/consult/Badge';
import { ErrorState, LoadingBlock } from '@/components/consult/States';
import { useApi } from '@/hooks/useApi';
import { admin } from '@/lib/consult/api';
import { formatPaise } from '@/lib/consult/format';
import { statusInfo } from '@/lib/consult/status';
import { formatIstDateTime } from '@/lib/consult/time';

const when = (iso: string | null) => (iso ? formatIstDateTime(iso) : 'Not yet');

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
    return (
        <dl className="divide-y divide-gray-100 text-sm">
            {rows.map(([label, value]) => (
                <div key={label} className="flex flex-wrap justify-between gap-2 py-2">
                    <dt className="text-gray-500">{label}</dt>
                    <dd className="font-medium text-gray-900">{value}</dd>
                </div>
            ))}
        </dl>
    );
}

const card = 'rounded-2xl border border-gray-100 bg-white p-5 shadow-sm';

/** Logistics only: notes and prescription content stay out of the admin view by design. */
export default function ConsultAppointmentPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const { data: a, error, loading, refetch } = useApi(() => admin.appointment(id), [id]);

    return (
        <div className="mx-auto max-w-[900px]">
            <PageHeader title="Appointment" back={{ href: '/super-admin/consult-appointments', label: 'Back to appointments' }} />
            {loading ? <LoadingBlock label="Loading appointment" />
                : error || !a ? <ErrorState message={error ?? 'We could not load this appointment.'} onRetry={refetch} />
                : (
                    <div className="space-y-4">
                        <section className={card}>
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                <h2 className="font-bold text-gray-900">{a.doctor.displayName} with {a.patient.name}</h2>
                                <Badge tone={statusInfo(a.status).tone}>{statusInfo(a.status).label}</Badge>
                            </div>
                            <Rows rows={[
                                ['Specialty', a.doctor.specialty.name],
                                ['Type', a.type.toLowerCase()],
                                ['Booked by (mobile)', a.user.mobile],
                                ['Booked at', formatIstDateTime(a.createdAt)],
                                ['Slot', `${formatIstDateTime(a.startsAt)} to ${formatIstDateTime(a.endsAt)}`],
                                ['Fee', `${formatPaise(a.feePaise)} (platform ${formatPaise(a.platformFeePaise)})`],
                                ['Prescription issued', a.prescriptionIssuedAt ? `Yes, ${formatIstDateTime(a.prescriptionIssuedAt)}` : 'No'],
                                ...(a.reviewReason ? [['Staff check', a.reviewReason] as [string, string]] : []),
                            ]} />
                        </section>
                        <section className={card}>
                            <h2 className="mb-2 font-bold text-gray-900">Call</h2>
                            <Rows rows={[
                                ['Patient joined', when(a.patientJoinedAt)],
                                ['Doctor joined', when(a.doctorJoinedAt)],
                                ['Started', when(a.startedAt)],
                                ['Ended', when(a.endedAt)],
                            ]} />
                        </section>
                        {a.cancelledAt && (
                            <section className={card}>
                                <h2 className="mb-2 font-bold text-gray-900">Cancellation</h2>
                                <Rows rows={[
                                    ['Cancelled at', formatIstDateTime(a.cancelledAt)],
                                    ['Cancelled by', a.cancelledBy ?? 'Unknown'],
                                    ['Reason', a.cancelReason ?? 'None given'],
                                ]} />
                            </section>
                        )}
                        <section className={card}>
                            <h2 className="mb-2 font-bold text-gray-900">Payments</h2>
                            {a.payments.length === 0 ? <p className="text-sm text-gray-500">No payments.</p> : (
                                <Rows rows={a.payments.map((p) => [
                                    `${formatIstDateTime(p.createdAt)}${p.razorpayPaymentId ? ` · ${p.razorpayPaymentId}` : ''}`,
                                    `${formatPaise(p.amountPaise)} · ${p.status.toLowerCase()}`,
                                ])} />
                            )}
                        </section>
                        <section className={card}>
                            <h2 className="mb-2 font-bold text-gray-900">Refunds</h2>
                            {a.refunds.length === 0 ? <p className="text-sm text-gray-500">No refunds.</p> : (
                                <Rows rows={a.refunds.map((r) => [formatIstDateTime(r.createdAt), `${formatPaise(r.amountPaise)} · ${r.status.toLowerCase()}`])} />
                            )}
                        </section>
                    </div>
                )}
        </div>
    );
}
