'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { consult, errorMessage } from '@/lib/consult/api';
import { formatPaise } from '@/lib/consult/format';
import type { CancelPreview, CancelResult } from '@/lib/consult/types';

interface Props {
    open: boolean;
    bookingId: string;
    /** Unpaid bookings have nothing to refund, so no estimate is fetched. */
    unpaid: boolean;
    onClose: () => void;
    onCancelled: () => void;
}

const REFUND_STATE: Record<NonNullable<CancelResult['refundStatus']>, string> = {
    PENDING: 'Your refund is on its way to your original payment method.',
    PROCESSED: 'Your refund has been sent to your original payment method.',
    FAILED: 'Your refund needs a manual step. Our team has been told and will sort it out.',
};

export function CancelDialog({ open, bookingId, unpaid, onClose, onCancelled }: Props) {
    const [preview, setPreview] = useState<CancelPreview | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<CancelResult | null>(null);
    const [wasUnpaid, setWasUnpaid] = useState(false);

    useEffect(() => {
        if (!open || unpaid || result) return;
        let alive = true;
        setPreview(null);
        setPreviewError(null);
        consult.cancelPreview(bookingId).then((p) => alive && setPreview(p)).catch((e) => alive && setPreviewError(errorMessage(e)));
        return () => {
            alive = false;
        };
    }, [open, unpaid, bookingId, result]);

    async function confirm() {
        setBusy(true);
        setError(null);
        setWasUnpaid(unpaid);
        try {
            setResult(await consult.cancel(bookingId, reason.trim() || undefined));
            onCancelled();
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setBusy(false);
        }
    }

    function close() {
        if (busy) return;
        setResult(null);
        setReason('');
        setError(null);
        onClose();
    }

    return (
        <Dialog open={open} onOpenChange={(next) => !next && close()}>
            <DialogContent>
                {result ? (
                    <>
                        <DialogHeader>
                            <DialogTitle>Booking cancelled</DialogTitle>
                            <DialogDescription>
                                {result.refundPaise > 0
                                    ? `Refund: ${formatPaise(result.refundPaise)}.`
                                    : wasUnpaid
                                      ? 'The time was released. Nothing was charged.'
                                      : 'No refund applies to this cancellation.'}
                            </DialogDescription>
                        </DialogHeader>
                        {result.refundPaise > 0 && result.refundStatus && <p role="status" className="text-sm">{REFUND_STATE[result.refundStatus]}</p>}
                        <div className="flex justify-end pt-2"><Button onClick={close}>Done</Button></div>
                    </>
                ) : (
                    <>
                        <DialogHeader>
                            <DialogTitle>Cancel this booking?</DialogTitle>
                            <DialogDescription>
                                {unpaid ? 'You have not paid yet, so nothing will be charged.' : 'This cannot be undone.'}
                            </DialogDescription>
                        </DialogHeader>
                        {!unpaid && (
                            <div aria-live="polite" className="rounded-xl bg-primary/5 p-3 text-sm">
                                {preview && (
                                    <p>
                                        About <b>{formatPaise(preview.refundPaise)}</b> will be refunded ({preview.percent}% of {formatPaise(preview.paidPaise)}). This is an estimate. You will see the final amount after cancelling.
                                    </p>
                                )}
                                {!preview && !previewError && <p>Checking your refund...</p>}
                                {previewError && <p className="font-semibold text-destructive">{previewError}</p>}
                            </div>
                        )}
                        <label htmlFor="cancel-reason" className="block text-sm font-semibold">Reason (optional)</label>
                        <textarea
                            id="cancel-reason"
                            value={reason}
                            maxLength={200}
                            onChange={(e) => setReason(e.target.value)}
                            className="min-h-20 w-full rounded-xl border border-border bg-input p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                        />
                        {error && <p role="alert" className="text-sm font-semibold text-destructive">{error}</p>}
                        <div className="flex justify-end gap-2 pt-2">
                            <Button variant="outline" onClick={close} disabled={busy}>Keep booking</Button>
                            <Button onClick={confirm} disabled={busy} className="bg-destructive hover:bg-destructive/90">
                                {busy ? 'Cancelling...' : 'Cancel booking'}
                            </Button>
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
