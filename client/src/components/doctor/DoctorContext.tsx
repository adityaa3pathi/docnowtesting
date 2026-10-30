'use client';
import { createContext, useContext } from 'react';
import type { DoctorMe } from '@/lib/consult/types';

export interface DoctorContextValue {
    doctor: DoctorMe;
    /** Replaces the cached profile after a save, so every screen shows the new data. */
    setDoctor: (next: DoctorMe) => void;
}

export const DoctorContext = createContext<DoctorContextValue | null>(null);

export function useDoctor(): DoctorContextValue {
    const ctx = useContext(DoctorContext);
    if (!ctx) throw new Error('useDoctor must be used inside the doctor layout');
    return ctx;
}
