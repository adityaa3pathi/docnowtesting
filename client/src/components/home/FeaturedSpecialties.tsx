/** Specialty grid (Server Component): eight specialties with the symptoms people search for. */
import Link from 'next/link';
import { ArrowRight, Baby, Bone, Brain, HeartPulse, Pill, Sparkles, Stethoscope, Venus, type LucideIcon } from 'lucide-react';
import { HOME_SPECIALTIES, specialtyHref } from '@/lib/home/specialties';

const LOOK: Record<string, { Icon: LucideIcon; tint: string }> = {
    'general-physician': { Icon: Stethoscope, tint: 'bg-purple-50 text-purple-700' },
    dermatologist: { Icon: Sparkles, tint: 'bg-pink-50 text-pink-600' },
    gynecologist: { Icon: Venus, tint: 'bg-fuchsia-50 text-fuchsia-700' },
    pediatrician: { Icon: Baby, tint: 'bg-sky-50 text-sky-700' },
    orthopedist: { Icon: Bone, tint: 'bg-amber-50 text-amber-700' },
    cardiologist: { Icon: HeartPulse, tint: 'bg-rose-50 text-rose-600' },
    psychiatrist: { Icon: Brain, tint: 'bg-indigo-50 text-indigo-700' },
    gastroenterologist: { Icon: Pill, tint: 'bg-emerald-50 text-emerald-700' },
};

export function FeaturedSpecialties() {
    return (
        <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" data-testid="specialty-grid">
            {HOME_SPECIALTIES.map((s) => {
                const { Icon, tint } = LOOK[s.key];
                return (
                    <li key={s.key}>
                        <Link
                            href={specialtyHref(s.key)}
                            data-testid={`specialty-${s.key}`}
                            className="group flex h-full flex-col rounded-3xl border border-gray-100 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg sm:p-5">
                            <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${tint} transition-transform group-hover:scale-110`}>
                                <Icon className="h-6 w-6" aria-hidden />
                            </span>
                            <h3 className="mt-3 text-base font-extrabold text-gray-900 sm:text-lg">{s.name}</h3>
                            <p className="mt-2 flex flex-wrap gap-1.5">
                                {s.symptoms.map((sym) => (
                                    <span key={sym} className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">{sym}</span>
                                ))}
                            </p>
                            <span className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-bold text-primary">
                                Consult Now <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                            </span>
                        </Link>
                    </li>
                );
            })}
        </ul>
    );
}
