'use client';
import { useState } from 'react';
import { Loader2, Video } from 'lucide-react';
import { Button } from '@/components/ui';
import { useServerNow } from '@/hooks/useServerNow';
import { errorMessage } from '@/lib/consult/api';
import { joinWindow } from '@/lib/consult/room';
import { formatIstDateTime } from '@/lib/consult/time';
import type { ConsultationStatus, ConsultationType, JoinResponse } from '@/lib/consult/types';
import { ConsultCallRoom } from './ConsultCallRoom';

interface Props {
    status: ConsultationStatus;
    type: ConsultationType;
    startsAt: string;
    endsAt: string;
    otherParty: 'doctor' | 'patient';
    join: () => Promise<JoinResponse>;
    /** Called after a successful join and after leaving, so the page can reload the status. */
    onChange?: () => void;
    /** Tells the page when this person enters or leaves the call. */
    onCallChange?: (inCall: boolean) => void;
}

/** Shows when the call opens, the Join button inside the window, then the call itself. */
export function JoinPanel({ status, type, startsAt, endsAt, otherParty, join, onChange, onCallChange }: Props) {
    const now = useServerNow();
    const [call, setCall] = useState<JoinResponse | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (call) {
        return (
            <ConsultCallRoom
                url={call.url}
                token={call.token}
                role={call.role}
                otherParty={otherParty}
                onLeave={() => {
                    setCall(null);
                    onCallChange?.(false);
                    onChange?.();
                }}
            />
        );
    }

    if (type === 'CHAT') return <p className="rounded-xl bg-gray-100 px-4 py-3 text-sm text-gray-700">Chat consultations are not available yet.</p>;

    const win = joinWindow({ status, startsAt, endsAt }, now);
    if (win.kind === 'not_joinable') return null;

    async function start() {
        setBusy(true);
        setError(null);
        try {
            setCall(await join());
            onCallChange?.(true);
            onChange?.();
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="space-y-3 rounded-2xl border border-border bg-white p-4">
            <p className="font-bold text-foreground">{type === 'AUDIO' ? 'Audio call' : 'Video call'}</p>
            {win.kind === 'early' && (
                <p className="text-sm text-muted-foreground">Join from {formatIstDateTime(win.opensAt)} (Indian time).</p>
            )}
            {win.kind === 'ended' && <p className="text-sm text-muted-foreground">The time to join this call has passed.</p>}
            {win.kind === 'open' && (
                <Button size="lg" className="w-full" disabled={busy} onClick={() => void start()}>
                    {busy ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden /> Joining</> : <><Video className="mr-2 h-5 w-5" aria-hidden /> Join call</>}
                </Button>
            )}
            {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-destructive">{error}</p>}
        </div>
    );
}
