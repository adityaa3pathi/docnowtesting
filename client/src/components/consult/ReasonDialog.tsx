'use client';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { errorMessage } from '@/lib/consult/api';

interface Props {
    open: boolean;
    title: string;
    description?: string;
    confirmLabel: string;
    destructive?: boolean;
    minLength?: number;
    maxLength?: number;
    onClose: () => void;
    onConfirm: (reason: string) => Promise<void>;
}

/** Asks for a short reason, then runs the action. Shows the server's message if it fails. */
export function ReasonDialog({ open, title, description, confirmLabel, destructive, minLength = 3, maxLength = 200, onClose, onConfirm }: Props) {
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const valid = reason.trim().length >= minLength;

    async function submit() {
        setBusy(true);
        setError(null);
        try {
            await onConfirm(reason.trim());
            setReason('');
            onClose();
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    {description && <DialogDescription>{description}</DialogDescription>}
                </DialogHeader>
                <label className="block text-sm font-semibold text-foreground" htmlFor="reason-input">
                    Reason
                </label>
                <textarea
                    id="reason-input"
                    value={reason}
                    maxLength={maxLength}
                    onChange={(e) => setReason(e.target.value)}
                    className="mt-1 min-h-24 w-full rounded-xl border border-border bg-input p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="text-xs text-muted-foreground">At least {minLength} characters.</p>
                {error && <p role="alert" className="text-sm font-semibold text-destructive">{error}</p>}
                <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={onClose} disabled={busy}>
                        Cancel
                    </Button>
                    <Button onClick={submit} disabled={!valid || busy} className={destructive ? 'bg-destructive hover:bg-destructive/90' : undefined}>
                        {busy ? 'Working...' : confirmLabel}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
