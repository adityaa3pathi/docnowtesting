'use client';

import { CorporateInquiriesView } from '@/components/admin/CorporateInquiriesView';

export default function SuperAdminCorporateInquiriesPage() {
    return <CorporateInquiriesView apiPrefix="/api/admin" />;
}
