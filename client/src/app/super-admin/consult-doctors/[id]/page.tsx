'use client';
import { use } from 'react';
import { PageHeader } from '@/components/admin/consult/shared';
import { DoctorDetail } from '@/components/admin/consult/DoctorDetail';

export default function ConsultDoctorPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    return (
        <div className="mx-auto max-w-[900px]">
            <PageHeader title="Doctor" back={{ href: '/super-admin/consult-doctors', label: 'Back to doctors' }} />
            <DoctorDetail id={id} />
        </div>
    );
}
