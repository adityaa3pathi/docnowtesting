'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LoadingBlock } from '@/components/consult/States';

/** The layout shows the application form itself whenever one is needed; this page only sends approved doctors home. */
export default function DoctorApplyPage() {
    const router = useRouter();
    useEffect(() => {
        router.replace('/doctor');
    }, [router]);
    return <LoadingBlock />;
}
