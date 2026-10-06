'use client';
import Link from 'next/link';
import { Button, Card } from '@/components/ui';
import { Badge } from '@/components/consult/Badge';
import { useDoctor } from '@/components/doctor/DoctorContext';
import { formatRupees } from '@/lib/consult/format';
import { windowsToForm } from '@/lib/consult/availability';
import { doctorStatusInfo } from '@/lib/consult/status';
import { WEEKDAYS } from '@/lib/consult/time';

export default function DoctorHomePage() {
    const { doctor } = useDoctor();
    const info = doctorStatusInfo(doctor.status);
    const week = windowsToForm(doctor.availability);
    const hasHours = week.some((d) => d.length > 0);

    return (
        <div className="space-y-4">
            <Card className="space-y-2 p-5">
                <Badge tone={info.tone}>{info.label}</Badge>
                <h1 className="text-xl font-bold text-foreground">{doctor.displayName}</h1>
                <p className="text-sm text-muted-foreground">
                    {doctor.specialty.name} · Fee {formatRupees(doctor.consultationFee)} · {doctor.slotMinutes} minute appointments
                </p>
            </Card>

            <Card className="p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="font-bold text-foreground">Your weekly hours</h2>
                    <Link href="/doctor/availability"><Button variant="outline" size="sm" type="button">Change hours</Button></Link>
                </div>
                {!hasHours ? (
                    <p className="text-sm text-muted-foreground">No hours set yet. Patients cannot book you until you add some.</p>
                ) : (
                    <dl className="space-y-1.5 text-sm">
                        {week.map((ranges, day) => (
                            <div key={day} className="flex gap-3">
                                <dt className="w-24 shrink-0 font-semibold text-foreground">{WEEKDAYS[day]}</dt>
                                <dd className="text-muted-foreground">{ranges.length ? ranges.map((r) => `${r.start} to ${r.end}`).join(', ') : 'Not available'}</dd>
                            </div>
                        ))}
                    </dl>
                )}
                <p className="mt-3 text-xs text-muted-foreground">All times are Indian time.</p>
            </Card>
        </div>
    );
}
