'use client';
import { PageHeader } from '@/components/admin/consult/shared';
import { OnlineNow } from '@/components/admin/consult/OnlineNow';

export default function ConsultOnlinePage() {
    return (
        <div className="mx-auto max-w-[1000px]">
            <PageHeader title="Online now" subtitle="Instant consults: which Docs are online, who is waiting, and how requests ended." />
            <OnlineNow />
        </div>
    );
}
