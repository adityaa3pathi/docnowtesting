'use client';
import { PageHeader } from '@/components/admin/consult/shared';
import { ReviewQueue } from '@/components/admin/consult/ReviewQueue';

export default function ConsultReviewPage() {
    return (
        <div className="mx-auto max-w-[1000px]">
            <PageHeader title="Consult review" subtitle="Payments and refunds that need a person to look at them." />
            <ReviewQueue />
        </div>
    );
}
