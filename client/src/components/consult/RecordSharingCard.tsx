'use client';
import { useState } from 'react';
import { FolderHeart } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { consult, errorMessage } from '@/lib/consult/api';
import { recordShareText } from '@/lib/consult/consent';
import { formatIstDateTime, formatIstDay } from '@/lib/consult/time';
import type { RecordSharing } from '@/lib/consult/types';

/**
 * "Let the doctor see the health record" on one booking: on or off, until when, and when the doctor
 * last opened it. Switching on shows the same wording as review-and-pay; switching off is immediate.
 */
export function RecordSharingCard({ bookingId, doctorName, patientName, sharing: initial }: { bookingId: string; doctorName: string; patientName: string; sharing: RecordSharing }) {
    const [sharing, setSharing] = useState(initial);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    if (!sharing.shared && !sharing.canShare) return null;

    async function set(share: boolean) {
        setBusy(true);
        setError(null);
        try {
            setSharing(await consult.setRecordSharing(bookingId, share));
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setBusy(false);
        }
    }

    return (
        <Card className="space-y-3 p-4" aria-label="Health record sharing">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                        <FolderHeart className="h-4 w-4 text-primary" aria-hidden />
                        {sharing.shared ? 'Health record shared with the doctor' : 'Health record not shared'}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-muted" data-testid="record-sharing-status">
                        {sharing.shared
                            ? `${doctorName} can see ${patientName}'s DocNow lab reports, past consultations and medical files until ${formatIstDay(sharing.until)}.`
                            : `${doctorName} sees only the details on this booking.`}
                    </p>
                    {sharing.lastViewedAt && <p className="mt-0.5 text-xs text-ink-subtle">Last opened by the doctor {formatIstDateTime(sharing.lastViewedAt)}</p>}
                </div>
                {sharing.shared ? (
                    <Button variant="outline" size="sm" loading={busy} onClick={() => void set(false)}>Stop sharing</Button>
                ) : null}
            </div>
            {!sharing.shared && (
                <div className="space-y-2 rounded-xl bg-surface-subtle p-3">
                    <p className="text-sm text-ink">{recordShareText(doctorName, patientName)}</p>
                    <Button size="sm" loading={busy} onClick={() => void set(true)}>I agree, share it</Button>
                </div>
            )}
            {error && <p role="alert" className="text-sm font-semibold text-danger-ink">{error}</p>}
        </Card>
    );
}
