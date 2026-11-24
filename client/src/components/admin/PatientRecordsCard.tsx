'use client';
import Link from 'next/link';
import { ChevronRight, HeartPulse, Loader2 } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { admin as adminApi } from '@/lib/consult/api';

/** The people on an account, each linking to their health record page (opening it is audit-logged). */
export function PatientRecordsCard({ userId }: { userId: string }) {
    const { data: people, error, loading } = useApi(() => adminApi.accountPeople(userId), [userId]);
    return (
        <section className="rounded-xl border border-gray-200 bg-white p-5" aria-label="Health records">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900"><HeartPulse size={18} className="text-[#4b2192]" aria-hidden /> Health records</h2>
            <p className="mb-3 text-sm text-gray-500">Opening a person&apos;s record is written to the audit log.</p>
            {loading && !people ? <Loader2 className="h-5 w-5 animate-spin text-[#4b2192]" aria-label="Loading people" />
                : error ? <p className="text-sm text-red-700">{error}</p>
                : !people?.length ? <p className="text-sm text-gray-500">No people on this account yet.</p>
                : (
                    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {people.map((p) => (
                            <li key={p.id}>
                                <Link href={`/super-admin/patients/${p.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 hover:bg-gray-50">
                                    <span className="min-w-0">
                                        <span className="block truncate font-medium text-gray-900">{p.name} <span className="font-normal text-gray-500">· {p.relation}</span></span>
                                        <span className="block text-xs text-gray-500">{p.age} y · {p.gender} · {p.consultations} {p.consultations === 1 ? 'consultation' : 'consultations'} · {p.documents} {p.documents === 1 ? 'file' : 'files'}</span>
                                    </span>
                                    <ChevronRight size={16} className="shrink-0 text-gray-400" aria-hidden />
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
        </section>
    );
}
