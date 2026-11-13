/**
 * The DocNow care loop (Server Component): consult → prescription → home sample collection →
 * reports. Every step describes what the product does today.
 */
import { FileText, FlaskConical, ClipboardList, Video } from 'lucide-react';

export const CARE_LOOP = [
    {
        title: 'Consult a Doctor Online',
        body: 'Pick a verified specialist, choose a time that suits you and talk on HD video from home.',
        icon: Video,
        tint: 'from-[#4b2192] to-[#6d3fc4]',
    },
    {
        title: 'Digital Prescription',
        body: 'Your doctor issues a prescription with medicines, dosage and their medical registration number, as the NMC Telemedicine Guidelines require. Download it as a PDF any time.',
        icon: FileText,
        tint: 'from-fuchsia-600 to-purple-600',
    },
    {
        title: '1-Tap Home Sample Collection',
        body: 'Tests your doctor recommends go into your cart in one tap. Pick a slot and a phlebotomist collects the sample at your home.',
        icon: FlaskConical,
        tint: 'from-teal-600 to-emerald-600',
    },
    {
        title: 'Digital Reports',
        body: 'Lab-certified reports arrive in your DocNow account within 24–48 hours, ready to share with your doctor at your next consultation.',
        icon: ClipboardList,
        tint: 'from-emerald-600 to-green-600',
    },
] as const;

export function CareLoop() {
    return (
        <ol className="relative grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4 lg:gap-6" data-testid="care-loop">
            <span aria-hidden className="absolute left-[12%] right-[12%] top-8 hidden h-0.5 bg-gradient-to-r from-purple-200 via-teal-300 to-emerald-200 lg:block" />
            {CARE_LOOP.map((step, i) => (
                <li key={step.title} className="relative z-10 flex flex-col rounded-3xl border border-gray-100 bg-white p-6 shadow-sm lg:items-center lg:text-center">
                    <span className={`flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br ${step.tint} text-white shadow-lg`}>
                        <step.icon className="h-7 w-7" aria-hidden />
                    </span>
                    <span className="mt-4 text-xs font-black uppercase tracking-[0.2em] text-purple-400">Step {String(i + 1).padStart(2, '0')}</span>
                    <h3 className="mt-1 text-lg font-extrabold text-gray-900">{step.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-gray-500">{step.body}</p>
                </li>
            ))}
        </ol>
    );
}
