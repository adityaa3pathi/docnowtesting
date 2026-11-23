'use client';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { healthApi, type HealthPerson } from '@/lib/health';
import { HealthDetailsForm } from './HealthDetailsForm';

/**
 * Right after sign-up: "Any allergies?" for the new account's own person. Skippable; the consult
 * booking page asks again if it was never answered.
 */
export function AllergyPromptDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    // Mounted only while open, so every sign-up starts with fresh state.
    return open ? <Prompt onClose={onClose} /> : null;
}

function Prompt({ onClose }: { onClose: () => void }) {
    const [person, setPerson] = useState<HealthPerson | null>(null);

    useEffect(() => {
        let alive = true;
        healthApi.ensureSelf()
            .then((p) => alive && setPerson(p))
            // Nothing to ask about (the profile could not make a "Self" person): don't block the person.
            .catch(() => alive && onClose());
        return () => { alive = false; };
    }, [onClose]);

    return (
        <Dialog open onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Any allergies?</DialogTitle>
                    <DialogDescription>
                        Doctors check this before they prescribe. You can skip it now and add it later in your profile.
                    </DialogDescription>
                </DialogHeader>
                {person ? (
                    <HealthDetailsForm person={person} mode="allergies" onSaved={onClose} onSkip={onClose} />
                ) : (
                    <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" aria-label="Loading" /></div>
                )}
            </DialogContent>
        </Dialog>
    );
}
