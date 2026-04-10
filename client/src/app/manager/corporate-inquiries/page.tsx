'use client';

import { CorporateInquiriesView } from '@/components/admin/CorporateInquiriesView';

export default function ManagerCorporateInquiriesPage() {
    return <CorporateInquiriesView apiPrefix="/api/manager" />;
}
