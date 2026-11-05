'use client';
import { useState } from 'react';
import { Info } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ABOUT_TELEMEDICINE } from '@/lib/consult/consent';

interface Props {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label: string;
    /** Bigger box and text for the family member's zero-login room. */
    senior?: boolean;
    language?: 'en' | 'hi';
}

/** The NMC telemedicine consent checkbox shown above every patient-side Join button, with a "learn more" sheet. */
export function TelemedicineConsent({ checked, onChange, label, senior = false, language = 'en' }: Props) {
    const [open, setOpen] = useState(false);
    const about = ABOUT_TELEMEDICINE[language];
    const other = ABOUT_TELEMEDICINE[language === 'hi' ? 'en' : 'hi'];
    return (
        <div className={`rounded-2xl border-2 p-4 ${checked ? 'border-[#4b2192] bg-[#F4F0FA]' : 'border-gray-200 bg-white'}`}>
            <label className={`flex cursor-pointer items-start gap-3 ${senior ? 'text-lg' : 'text-sm'} leading-relaxed text-gray-900`}>
                <input
                    type="checkbox"
                    data-testid="consent-checkbox"
                    checked={checked}
                    onChange={(e) => onChange(e.target.checked)}
                    className={`${senior ? 'mt-1 h-7 w-7' : 'mt-0.5 h-5 w-5'} shrink-0 accent-[#4b2192]`}
                />
                <span>{label}</span>
            </label>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className={`mt-2 inline-flex items-center gap-1.5 font-semibold text-[#4b2192] underline-offset-2 hover:underline ${senior ? 'text-base' : 'text-xs'}`}>
                <Info className="h-4 w-4" aria-hidden />
                {language === 'hi' ? 'NMC टेलीमेडिसिन दिशा-निर्देशों के बारे में जानें' : 'Learn more about NMC Telemedicine Guidelines'}
            </button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{about.title}</DialogTitle>
                        <DialogDescription>{other.title}</DialogDescription>
                    </DialogHeader>
                    <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-gray-800">
                        {about.points.map((p) => <li key={p}>{p}</li>)}
                    </ul>
                </DialogContent>
            </Dialog>
        </div>
    );
}
