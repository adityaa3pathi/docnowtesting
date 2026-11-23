'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button, Notice } from '@/components/ui';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { consult, errorMessage, errorStatus } from '@/lib/consult/api';
import { changeTimeRules, movableSlots } from '@/lib/consult/changeTime';
import { formatIstDateTime, serverNow } from '@/lib/consult/time';
import type { BookingView, SelfReschedule, Slot } from '@/lib/consult/types';
import { SlotPicker } from './SlotPicker';
import { LoadingBlock } from './States';

interface Props {
    open: boolean;
    booking: BookingView & { selfReschedule: SelfReschedule };
    onClose: () => void;
    onChanged: (b: BookingView) => void;
    /** The booking can no longer move (cutoff passed, limit reached, changed elsewhere): reload it. */
    onStale: () => void;
}

/** Must match SLOT_GONE in the server's consultations.reschedule.ts. */
const SLOT_GONE = 'That time was just taken. Please pick another.';

/** Pick another free time with the same doctor. Free; the rules come from the booking. */
export function ChangeTimeDialog(props: Props) {
    // Mounted only while open, so every opening starts clean: no old error, choice or list.
    return props.open ? <ChangeTimeBody {...props} /> : null;
}

function ChangeTimeBody({ booking, onClose, onChanged, onStale }: Props) {
    const [slots, setSlots] = useState<Slot[] | null>(null);
    const [picked, setPicked] = useState<Slot | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const lead = booking.selfReschedule.minLeadMinutes;
    const load = useCallback(async () => {
        try {
            const all = await consult.slots(booking.doctorId);
            setSlots(movableSlots(all, booking.startsAt, serverNow(), lead));
        } catch (e) {
            setError(errorMessage(e));
            setSlots([]);
        }
    }, [booking.doctorId, booking.startsAt, lead]);

    useEffect(() => {
        void load();
    }, [load]);

    async function confirm() {
        if (!picked) return;
        setBusy(true);
        setError(null);
        try {
            onChanged(await consult.changeTime(booking.consultationId, picked.id));
            setPicked(null);
        } catch (e) {
            const message = errorMessage(e);
            if (errorStatus(e) === 409 && message !== SLOT_GONE) {
                // Not about this slot: the booking itself can't move now. The page shows why.
                onStale();
                return;
            }
            // Someone took that time first: show fresh times and keep the dialog open.
            if (errorStatus(e) === 409) {
                setPicked(null);
                void load();
            }
            setError(message);
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
            <DialogContent className="max-h-[90vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Change the time</DialogTitle>
                    <DialogDescription>
                        Now: {formatIstDateTime(booking.startsAt)} with {booking.doctorName}. {changeTimeRules(booking.selfReschedule)}
                    </DialogDescription>
                </DialogHeader>
                {slots === null ? <LoadingBlock label="Loading free times" />
                    : slots.length === 0 ? <Notice tone="info">{booking.doctorName} has no other free times right now. Please check again later.</Notice>
                    : <SlotPicker slots={slots} selectedId={picked?.id ?? null} onSelect={setPicked} />}
                {error && <Notice tone="danger">{error}</Notice>}
                <p className="text-xs text-ink-muted">
                    Nothing more to pay. If you cancel later, the refund counts from the earliest time this booking had, so changing the time never raises it.
                </p>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                    <Button variant="secondary" className="sm:flex-1" onClick={onClose} disabled={busy}>Keep my time</Button>
                    <Button className="sm:flex-1" disabled={!picked} loading={busy} onClick={() => void confirm()}>
                        {picked ? `Move to ${formatIstDateTime(picked.startsAt)}` : 'Pick a new time'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
