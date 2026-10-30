'use client';
import { PageHeader } from '@/components/admin/consult/shared';
import { DoctorForm } from '@/components/admin/consult/DoctorForm';

export default function NewConsultDoctorPage() {
    return (
        <div className="mx-auto max-w-[1000px]">
            <PageHeader title="Add a doctor" subtitle="Create a doctor on their behalf. You can approve them on the next page." back={{ href: '/super-admin/consult-doctors', label: 'Back to doctors' }} />
            <DoctorForm />
        </div>
    );
}
