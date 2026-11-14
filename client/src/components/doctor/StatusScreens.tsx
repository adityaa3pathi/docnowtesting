import { Card } from '@/components/ui';
import { Badge } from '@/components/consult/Badge';
import { doctorStatusInfo } from '@/lib/consult/status';
import type { DoctorMe } from '@/lib/consult/types';
import { DoctorPhotoUpload } from './DoctorPhotoUpload';

export function PendingScreen({ doctor, onPhoto }: { doctor: DoctorMe; onPhoto: (url: string) => void }) {
    const info = doctorStatusInfo('PENDING');
    return (
        <div className="space-y-4">
        {!doctor.photoUrl && (
            <Card className="space-y-3 border-warning/30 bg-warning-soft p-5">
                <h2 className="font-bold text-warning-ink">Add your photo</h2>
                <p className="text-sm text-ink">We can approve you only once your photo is added.</p>
                <DoctorPhotoUpload name={doctor.displayName} photoUrl={doctor.photoUrl} onUploaded={onPhoto} />
            </Card>
        )}
        <Card className="space-y-3 p-6 text-center sm:p-10">
            <Badge tone={info.tone}>{info.label}</Badge>
            <h1 className="text-xl font-bold text-foreground">Thanks, {doctor.displayName}</h1>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
                We are checking your details. This page updates when you open it again. You can set your hours once you are approved.
            </p>
        </Card>
        </div>
    );
}

export function SuspendedScreen({ doctor }: { doctor: DoctorMe }) {
    const info = doctorStatusInfo('SUSPENDED');
    return (
        <Card className="space-y-3 p-6 text-center sm:p-10">
            <Badge tone={info.tone}>{info.label}</Badge>
            <h1 className="text-xl font-bold text-foreground">Your account is paused</h1>
            {doctor.statusReason && (
                <p className="mx-auto max-w-md rounded-xl bg-red-50 px-4 py-3 text-sm text-destructive">Reason: {doctor.statusReason}</p>
            )}
            <p className="mx-auto max-w-md text-sm text-muted-foreground">Patients cannot book you right now. Please contact the Docnow team to sort this out.</p>
        </Card>
    );
}

export function RejectedNotice({ doctor }: { doctor: DoctorMe }) {
    const info = doctorStatusInfo('REJECTED');
    return (
        <Card className="mb-4 space-y-2 border-red-100 bg-red-50 p-5">
            <Badge tone={info.tone}>{info.label}</Badge>
            <h1 className="text-lg font-bold text-foreground">Your application needs changes</h1>
            {doctor.statusReason && <p className="text-sm text-destructive">Reason: {doctor.statusReason}</p>}
            <p className="text-sm text-muted-foreground">Fix the details below and send it again.</p>
        </Card>
    );
}
