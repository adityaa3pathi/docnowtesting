'use client';

import { CallbacksView } from '@/components/admin/CallbacksView';

export default function SuperAdminCallbacksPage() {
    return <CallbacksView apiPrefix="/api/admin" />;
}
