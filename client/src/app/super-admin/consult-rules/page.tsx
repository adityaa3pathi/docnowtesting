'use client';
import { PageHeader } from '@/components/admin/consult/shared';
import { RulesForm } from '@/components/admin/consult/RulesForm';

export default function ConsultRulesPage() {
    return (
        <div className="mx-auto max-w-[900px]">
            <PageHeader title="Consult rules" subtitle="Refunds, fees and timing for consultations. Each save creates a new version." />
            <RulesForm />
        </div>
    );
}
