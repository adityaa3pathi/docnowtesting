/**
 * Assisted family care spotlight (Server Component). The phone on the right is an illustration of
 * the real zero-login room parents open from WhatsApp, drawn in HTML so it costs no image bytes.
 */
import Link from 'next/link';
import { ArrowRight, ClipboardList, MessageCircle, PhoneCall, Smartphone, Stethoscope, Users } from 'lucide-react';

export const FAMILY_HEADLINE = 'Caring for Your Parents, Even When You’re Miles Away';

const POINTS = [
    {
        icon: Smartphone,
        title: 'No app or login for your parents',
        body: 'They get a WhatsApp link that opens a senior-friendly video room with large Hindi and English buttons. No OTP, no password.',
    },
    {
        icon: Users,
        title: 'Join the call to help',
        body: 'Join the same video call from your phone, so you can help explain symptoms and hear the doctor’s advice first-hand.',
    },
    {
        icon: ClipboardList,
        title: 'The doctor comes prepared',
        body: 'Add long-term conditions like BP or diabetes, allergies, daily medicines and old reports or prescriptions when you book.',
    },
] as const;

function GuestRoomIllustration() {
    return (
        <div role="img" aria-label="A parent's phone showing the DocNow call link from WhatsApp and a large Start Call button" className="relative mx-auto w-full max-w-[300px] sm:pt-20">
            <div className="absolute -left-10 top-0 z-10 hidden max-w-[220px] rounded-2xl rounded-tl-sm bg-[#dcf8c6] p-3 text-xs text-gray-800 shadow-xl sm:block" aria-hidden>
                <p className="flex items-center gap-1 font-bold text-emerald-800"><MessageCircle className="h-3.5 w-3.5" /> DocNow</p>
                <p className="mt-1">Namaste! Your consultation with Dr. Sharma is at 5:30 PM. Tap to join: docnow.in/call/…</p>
            </div>
            <div className="rounded-[2.5rem] border-[10px] border-gray-900 bg-white p-4 shadow-2xl" aria-hidden>
                <div className="mx-auto mb-4 h-1.5 w-16 rounded-full bg-gray-200" />
                <p className="text-lg font-extrabold leading-snug text-gray-900">नमस्ते सुनीता जी</p>
                <p className="text-xs font-medium text-gray-500">Namaste Sunita ji</p>
                <div className="mt-4 flex items-center gap-3 rounded-2xl border-2 border-gray-100 p-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-white"><Stethoscope className="h-5 w-5" /></span>
                    <div>
                        <p className="text-sm font-bold text-gray-900">Dr. Sharma</p>
                        <p className="text-[11px] text-gray-500">General Physician · 5:30 PM</p>
                    </div>
                </div>
                <div className="mt-4 flex min-h-16 items-center justify-center gap-2 rounded-2xl bg-primary px-3 text-center text-base font-extrabold text-white">
                    <PhoneCall className="h-5 w-5 shrink-0" /> डॉक्टर से बात करें (Start Call)
                </div>
                <p className="mt-3 text-center text-[11px] text-gray-500">No app or login needed</p>
            </div>
        </div>
    );
}

export function FamilyCareSpotlight() {
    return (
        <div className="grid items-center gap-12 lg:grid-cols-[1.2fr_1fr]" data-testid="family-care">
            <div>
                <span className="inline-flex items-center gap-2 rounded-full border border-purple-200 bg-white px-4 py-1.5 text-sm font-bold text-primary">
                    <Users className="h-4 w-4" aria-hidden /> Assisted Family Consultations
                </span>
                <h2 className="mt-4 text-3xl font-black leading-tight text-gray-900 md:text-5xl">{FAMILY_HEADLINE}</h2>
                <p className="mt-4 max-w-xl text-lg font-medium text-gray-600">
                    Living in Bengaluru or Mumbai while your parents are in Lucknow or Jaipur? Book a doctor for them in a few taps, and be there on the call.
                </p>
                <ul className="mt-8 space-y-5">
                    {POINTS.map((p) => (
                        <li key={p.title} className="flex gap-4">
                            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-white shadow-md"><p.icon className="h-6 w-6" aria-hidden /></span>
                            <div>
                                <h3 className="text-lg font-extrabold text-gray-900">{p.title}</h3>
                                <p className="mt-1 text-sm leading-relaxed text-gray-600">{p.body}</p>
                            </div>
                        </li>
                    ))}
                </ul>
                <Link href="/consult" data-testid="family-cta" className="mt-8 inline-flex min-h-12 items-center gap-2 rounded-2xl bg-primary px-6 text-base font-extrabold text-white shadow-lg shadow-purple-900/20 transition-colors hover:bg-[#3d1a7a]">
                    Book an Assisted Consultation for Family <ArrowRight className="h-5 w-5" aria-hidden />
                </Link>
            </div>
            <GuestRoomIllustration />
        </div>
    );
}
