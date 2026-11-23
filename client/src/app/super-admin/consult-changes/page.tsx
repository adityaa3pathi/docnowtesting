'use client';
import { PageHeader } from '@/components/admin/consult/shared';
import { DoctorChangeQueue } from '@/components/admin/consult/DoctorChangeQueue';

export default function ConsultChangesPage() {
    return (
        <div className="mx-auto max-w-[1000px]">
            <PageHeader title="Doctor changes" subtitle="New weekly hours and profile details wait here. Nothing changes for patients until you approve." />
            <DoctorChangeQueue />
        </div>
    );
}
