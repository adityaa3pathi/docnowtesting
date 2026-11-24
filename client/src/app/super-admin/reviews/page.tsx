'use client';
import { PageHeader } from '@/components/admin/consult/shared';
import { ReviewModeration } from '@/components/admin/consult/ReviewModeration';

export default function ReviewsPage() {
    return (
        <div className="mx-auto max-w-[1000px]">
            <PageHeader title="Reviews" subtitle="Patients' reviews of doctors and of DocNow. Hide, delete, reply, or remove personal details. DocNow never writes reviews." />
            <ReviewModeration />
        </div>
    );
}
