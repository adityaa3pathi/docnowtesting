'use client';
import { AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';
import { allergyState } from '@/lib/health';
import { cn } from '@/lib/utils';

interface Props {
    allergies?: string[];
    allergiesConfirmedAt?: string | null;
    /** `overlay` sits on top of the video: compact, and a long list scrolls instead of covering the call. */
    variant?: 'overlay' | 'inline';
    className?: string;
}

/**
 * The patient's allergies where the doctor is looking: over the video and in the prescription
 * builder. A listed allergy is bright red; "never asked" is amber, never shown as "none".
 */
export function AllergyAlert({ allergies, allergiesConfirmedAt, variant = 'inline', className }: Props) {
    const state = allergyState({ allergies, allergiesConfirmedAt });
    const overlay = variant === 'overlay';
    if (state === 'listed') {
        return (
            <div role="alert" data-testid="allergy-alert" data-state="listed"
                className={cn('flex items-start gap-2 rounded-xl bg-red-600 px-3 py-2 text-white shadow-lg', overlay ? 'max-h-24 overflow-y-auto text-sm' : 'text-base', className)}>
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                <p className="min-w-0"><span className="font-bold uppercase tracking-wide">Allergies:</span> <span className="font-semibold">{allergies!.join(', ')}</span></p>
            </div>
        );
    }
    if (state === 'unknown') {
        return (
            <div role="status" data-testid="allergy-alert" data-state="unknown"
                className={cn('flex items-start gap-2 rounded-xl bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-900', overlay && 'shadow-lg', className)}>
                <HelpCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <p>Allergies not confirmed. Ask the patient before prescribing.</p>
            </div>
        );
    }
    return (
        <div role="status" data-testid="allergy-alert" data-state="none"
            className={cn('flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-medium', overlay ? 'bg-black/60 text-white' : 'bg-success-soft text-success-ink', className)}>
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            <p>No known allergies (told by the patient)</p>
        </div>
    );
}
