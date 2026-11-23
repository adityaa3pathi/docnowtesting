'use client';
import { useRef, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { DoctorAvatar } from '@/components/consult/DoctorCard';
import { doctor as doctorApi, errorMessage } from '@/lib/consult/api';
import { PHOTO_TYPES, shrinkPhoto } from '@/lib/consult/photo';

const OWN_PHOTO_HINT = 'A clear, recent photo of your face. Patients see it when booking.';

/**
 * Pick, shrink and upload a doctor's photo; `onUploaded` gets the new stable link. Uploads the
 * signed-in doctor's own photo unless `upload` says otherwise (the super admin's doctor page).
 */
export function DoctorPhotoUpload({ name, photoUrl, onUploaded, upload = doctorApi.uploadPhoto, hint = OWN_PHOTO_HINT }: {
    name: string;
    photoUrl?: string | null;
    onUploaded: (url: string) => void;
    upload?: (photo: Blob) => Promise<{ photoUrl: string }>;
    hint?: string;
}) {
    const input = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function pick(file: File | undefined) {
        if (!file) return;
        if (!PHOTO_TYPES.includes(file.type)) return setError('Choose a JPG, PNG or WebP photo.');
        setBusy(true);
        setError(null);
        try {
            const { photoUrl: url } = await upload(await shrinkPhoto(file));
            onUploaded(url);
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setBusy(false);
            if (input.current) input.current.value = '';
        }
    }

    return (
        <div className="flex items-center gap-4">
            <DoctorAvatar doctor={{ displayName: name || 'Doctor', photoUrl: photoUrl ?? null }} className="h-20 w-20 text-xl" />
            <div className="space-y-1">
                <input ref={input} type="file" accept={PHOTO_TYPES.join(',')} className="sr-only" id="doctor-photo" onChange={(e) => void pick(e.target.files?.[0])} />
                <label
                    htmlFor="doctor-photo"
                    className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-border-strong bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-subtle focus-within:ring-2 focus-within:ring-primary"
                >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Camera className="h-4 w-4" aria-hidden />}
                    {busy ? 'Uploading…' : photoUrl ? 'Change photo' : 'Upload photo'}
                </label>
                <p className="text-xs text-ink-muted">{hint}</p>
                {error && <p role="alert" className="text-xs font-medium text-danger">{error}</p>}
            </div>
        </div>
    );
}
