'use client';
import { formatRupees } from '@/lib/consult/format';
import { useDoctorDirectory } from './useDoctorDirectory';

/** " (From ₹299)" on the consult button: the lowest fee among listed doctors, or nothing until it is known. */
export function ConsultFromFee() {
    const { data } = useDoctorDirectory();
    const fees = (data ?? []).map((d) => d.consultationFee).filter((f) => f > 0);
    if (!fees.length) return null;
    return <span data-testid="consult-from-fee"> (From {formatRupees(Math.min(...fees))})</span>;
}

/** The live count of approved doctors for the stats strip; a fixed-size placeholder until it loads. */
export function DoctorCountStat() {
    const { data, loading } = useDoctorDirectory();
    if (loading) return <span aria-hidden className="inline-block h-8 w-12 animate-pulse rounded-md bg-gray-100 align-middle" />;
    const n = data?.length ?? 0;
    return <span data-testid="doctor-count">{n > 0 ? n : '✓'}</span>;
}
