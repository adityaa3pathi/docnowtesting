import { redirect } from 'next/navigation';

// Root /super-admin redirects to dashboard
export default function SuperAdminPage() {
    redirect('/super-admin/dashboard');
}
