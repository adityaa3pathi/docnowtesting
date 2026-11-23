'use client';
import { useState } from 'react';
import { Clock, XCircle } from 'lucide-react';
import { Button } from '@/components/ui';
import { ChangeDiff } from '@/components/consult/ChangeDiff';
import { doctor as doctorApi, errorMessage } from '@/lib/consult/api';
import { changeDiff, lastDecision, pendingChange, withChange } from '@/lib/consult/changes';
import { formatIstDateTime } from '@/lib/consult/time';
import type { DoctorChangeKind, DoctorChangeRequest } from '@/lib/consult/types';
import { useDoctor } from './DoctorContext';

const WHAT: Record<DoctorChangeKind, { live: string }> = {
    AVAILABILITY: { live: 'Patients can still book your current hours until then.' },
    PROFILE: { live: 'Patients still see your current details until then.' },
};

/**
 * What happened to the doctor's last change of this kind: waiting (with the before/after and a way to
 * take it back), or not approved (with the admin's reason). Shows nothing when there is no news.
 */
export function ChangeNotice({ kind, onWithdrawn }: { kind: DoctorChangeKind; onWithdrawn?: () => void }) {
    const { doctor, setDoctor } = useDoctor();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const pending = pendingChange(doctor.changeRequests, kind);
    const decided = lastDecision(doctor.changeRequests, kind);

    async function withdraw(request: DoctorChangeRequest) {
        setBusy(true);
        setError(null);
        try {
            await doctorApi.withdrawChange(request.id);
            setDoctor({ ...doctor, changeRequests: withChange(doctor.changeRequests, kind, null) });
            onWithdrawn?.();
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setBusy(false);
        }
    }

    if (pending) {
        return (
            <div role="status" className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
                <div className="flex items-start gap-3">
                    <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden />
                    <div className="text-sm">
                        <p className="font-semibold text-amber-900">Waiting for approval</p>
                        <p className="text-amber-900/80">
                            Sent {formatIstDateTime(pending.createdAt)}. A DocNow admin checks every change. {WHAT[kind].live}
                        </p>
                    </div>
                </div>
                <ChangeDiff rows={changeDiff(kind, pending.previous, pending.payload)} />
                {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
                <Button variant="outline" size="sm" type="button" disabled={busy} onClick={() => withdraw(pending)}>
                    {busy ? 'Taking back...' : 'Take back this change'}
                </Button>
            </div>
        );
    }
    if (decided?.status === 'REJECTED') {
        return (
            <div role="status" className="flex items-start gap-3 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm">
                <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
                <div>
                    <p className="font-semibold text-destructive">Your last change was not approved</p>
                    {decided.reviewReason && <p className="text-gray-700">Reason: {decided.reviewReason}</p>}
                    <p className="text-gray-600">Nothing changed for patients. You can edit and send it again.</p>
                </div>
            </div>
        );
    }
    return null;
}
