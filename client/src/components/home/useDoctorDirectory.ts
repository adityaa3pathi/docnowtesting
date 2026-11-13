'use client';
import { useApi } from '@/hooks/useApi';
import { consult } from '@/lib/consult/api';
import type { DoctorSummary } from '@/lib/consult/types';

/**
 * One request for the approved-doctor list, shared by every homepage island that needs it (hero
 * fee, stats, search, featured doctors). A failed request is forgotten so Retry asks again.
 */
let pending: Promise<DoctorSummary[]> | null = null;

export function loadDoctorDirectory(): Promise<DoctorSummary[]> {
    pending ??= consult.doctors().catch((e) => {
        pending = null;
        throw e;
    });
    return pending;
}

export function useDoctorDirectory() {
    return useApi(loadDoctorDirectory, []);
}

/** Test helper. */
export function resetDoctorDirectoryForTests() {
    pending = null;
}
