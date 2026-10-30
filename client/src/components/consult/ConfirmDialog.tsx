'use client';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { errorMessage } from '@/lib/consult/api';

interface Props {
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    destructive?: boolean;
    onClose: () => void;
    onConfirm: () => Promise<void>;
}

/** A yes/no check before an action that cannot be undone. Shows the server's message if it fails. */
export function ConfirmDialog({ open, title, description, confirmLabel, destructive, onClose, onConfirm }: Props) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    function close() {
        if (busy) return;
        setError(null);
        onClose();
    }

    async function confirm() {
        setBusy(true);
        setError(null);
        try {
            await onConfirm();
            onClose();
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={(next) => !next && close()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                {error && <p role="alert" className="text-sm font-semibold text-destructive">{error}</p>}
                <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={close} disabled={busy}>Go back</Button>
                    <Button onClick={() => void confirm()} disabled={busy} className={destructive ? 'bg-destructive hover:bg-destructive/90' : undefined}>
                        {busy ? 'Working...' : confirmLabel}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
