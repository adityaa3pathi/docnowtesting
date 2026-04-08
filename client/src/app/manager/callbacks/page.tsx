'use client';

import { CallbacksView } from '@/components/admin/CallbacksView';

export default function ManagerCallbacksPage() {
    return <CallbacksView apiPrefix="/api/manager" />;
}
