'use client';
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, Hand, Mic, PhoneCall, Stethoscope } from 'lucide-react';
import { ConsultCallRoom } from '@/components/consult/ConsultCallRoom';
import { TelemedicineConsent } from '@/components/consult/TelemedicineConsent';
import { errorMessage, errorStatus, guest } from '@/lib/consult/api';
import { GUEST_CONSENT_REQUIRED_HINT, GUEST_CONSENT_TEXT } from '@/lib/consult/consent';
import { guestCopy, type GuestInfo, type GuestLanguage } from '@/lib/consult/guest';
import type { JoinResponse } from '@/lib/consult/types';
import { formatIstDay, formatIstTime } from '@/lib/consult/time';

const POLL_MS = 15_000;

/** A soft two-note chime, made in the browser so no audio file is needed. */
function playChime(ctx: AudioContext | null) {
    if (!ctx) return;
    try {
        const now = ctx.currentTime;
        for (const [i, freq] of [880, 1174.66].entries()) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.0001, now + i * 0.22);
            gain.gain.exponentialRampToValueAtTime(0.35, now + i * 0.22 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.22 + 0.6);
            osc.connect(gain).connect(ctx.destination);
            osc.start(now + i * 0.22);
            osc.stop(now + i * 0.22 + 0.65);
        }
    } catch {
        // Some browsers refuse audio before a tap; the visual badge still shows.
    }
}

function Bilingual({ primary, secondary, as: Tag = 'p', className = '' }: { primary: string; secondary: string; as?: 'p' | 'h1' | 'h2'; className?: string }) {
    return (
        <Tag className={className}>
            <span className="block">{primary}</span>
            <span className="mt-1 block text-[0.8em] font-medium text-gray-600">{secondary}</span>
        </Tag>
    );
}

function Problem({ status, message }: { status?: number; message: string }) {
    const expired = status === 410;
    return (
        <main className="mx-auto flex min-h-[80vh] max-w-md flex-col items-center justify-center gap-4 px-5 text-center text-lg">
            <Image src="/docnow-logo.png" alt="DocNow" width={120} height={40} className="h-10 w-auto" priority />
            <h1 className="text-2xl font-bold text-gray-950">{expired ? 'यह लिंक अब काम नहीं करता' : 'यह लिंक सही नहीं है'}</h1>
            <p className="text-gray-800">{message}</p>
            <p className="text-base text-gray-600">
                {expired
                    ? 'Please ask your family member to book again, or call DocNow support.'
                    : 'Please check the link in your WhatsApp message, or ask your family member to send it again.'}
            </p>
        </main>
    );
}

/**
 * The family member's zero-login call room: opened from WhatsApp on any phone browser. Built for
 * elderly callers: one big button, large high-contrast text, Hindi and English together.
 */
export function GuestRoom({ token }: { token: string }) {
    const [info, setInfo] = useState<GuestInfo | null>(null);
    const [problem, setProblem] = useState<{ status?: number; message: string } | null>(null);
    const [lang, setLang] = useState<GuestLanguage | null>(null);
    const [joining, setJoining] = useState(false);
    const [joinError, setJoinError] = useState<string | null>(null);
    const [call, setCall] = useState<JoinResponse | null>(null);
    const [ended, setEnded] = useState(false);
    const [consented, setConsented] = useState(false);
    const audio = useRef<AudioContext | null>(null);
    const chimed = useRef(false);

    const load = useCallback(async () => {
        try {
            const next = await guest.info(token);
            setInfo(next);
            setProblem(null);
        } catch (e) {
            setProblem({ status: errorStatus(e), message: errorMessage(e, 'We could not open this consultation.') });
        }
    }, [token]);

    useEffect(() => {
        const first = setTimeout(() => void load(), 0);
        // Keep the page fresh while waiting: the room opening and the doctor arriving both show by themselves.
        const t = setInterval(() => void load(), POLL_MS);
        return () => {
            clearTimeout(first);
            clearInterval(t);
        };
    }, [load]);

    const doctorArrived = useCallback(() => {
        if (chimed.current) return;
        chimed.current = true;
        playChime(audio.current);
    }, []);

    // Chime once when polling sees the doctor arrive before the call starts.
    useEffect(() => {
        if (info?.doctorJoined && !call) doctorArrived();
    }, [info?.doctorJoined, call, doctorArrived]);

    async function start() {
        if (!consented) return;
        // A tap is what lets the browser play sound later, so the audio is set up here.
        try {
            audio.current ??= new AudioContext();
            void audio.current.resume();
        } catch {
            audio.current = null;
        }
        setJoining(true);
        setJoinError(null);
        try {
            setCall(await guest.join(token, true));
            setEnded(false);
        } catch (e) {
            setJoinError(errorMessage(e, 'We could not start the call. Please check your internet and try again.'));
            void load();
        } finally {
            setJoining(false);
        }
    }

    if (problem && !info) return <Problem status={problem.status} message={problem.message} />;
    if (!info) {
        return (
            <main className="flex min-h-[80vh] items-center justify-center text-xl text-gray-700" role="status">
                कृपया प्रतीक्षा करें… / Please wait…
            </main>
        );
    }

    const shown = { ...info, language: lang ?? info.language };
    const copy = guestCopy(shown);
    const open = info.window === 'open';
    const audioOnly = info.type === 'AUDIO';

    if (call) {
        return (
            <main className="mx-auto max-w-3xl space-y-3 px-3 py-4 text-lg">
                <Bilingual
                    as="h1"
                    className="text-center text-xl font-bold text-gray-950"
                    primary={info.doctorJoined || chimed.current ? copy.primary.doctorIn : copy.primary.waitingForDoctor}
                    secondary={info.doctorJoined || chimed.current ? copy.secondary.doctorIn : copy.secondary.waitingForDoctor}
                />
                <ConsultCallRoom
                    url={call.url}
                    token={call.token}
                    role={call.role}
                    otherParty="doctor"
                    senior
                    onDoctorJoined={doctorArrived}
                    onLeave={() => {
                        setCall(null);
                        setEnded(true);
                        void load();
                    }}
                />
            </main>
        );
    }

    return (
        <main className="mx-auto flex max-w-md flex-col gap-5 px-5 py-6 text-lg leading-relaxed text-gray-950">
            <header className="flex items-center justify-between">
                <Image src="/docnow-logo.png" alt="DocNow" width={108} height={36} className="h-9 w-auto" priority />
                <button
                    type="button"
                    onClick={() => setLang(shown.language === 'hi' ? 'en' : 'hi')}
                    className="rounded-full border-2 border-gray-300 px-4 py-2 text-base font-semibold"
                    aria-label={shown.language === 'hi' ? 'Switch to English' : 'हिन्दी में देखें'}>
                    {shown.language === 'hi' ? 'English' : 'हिन्दी'}
                </button>
            </header>

            <Bilingual
                as="h1"
                className="text-[1.65rem] font-extrabold leading-snug"
                primary={info.doctorJoined ? copy.primary.greeting : copy.primary.waiting}
                secondary={info.doctorJoined ? copy.secondary.greeting : copy.secondary.waiting}
            />

            <section className="flex items-center gap-4 rounded-3xl border-2 border-gray-200 bg-white p-4" aria-label="Your doctor">
                {info.doctor.photoUrl ? (
                    // Doctor photos live on any host the admin used, which next/image would need listed.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={info.doctor.photoUrl} alt="" className="h-20 w-20 rounded-full object-cover" />
                ) : (
                    <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[#4b2192] text-white">
                        <Stethoscope className="h-10 w-10" aria-hidden />
                    </span>
                )}
                <div>
                    <p className="text-xl font-bold">{info.doctor.name.startsWith('Dr') ? info.doctor.name : `Dr. ${info.doctor.name}`}</p>
                    <p className="text-base text-gray-700">{info.doctor.qualification} · {info.doctor.specialty}</p>
                    <p className="text-base font-semibold text-gray-900">
                        {formatIstDay(info.startsAt)}, {formatIstTime(info.startsAt)}
                    </p>
                </div>
            </section>

            {info.doctorJoined ? (
                <p role="alert" className="flex items-center gap-3 rounded-2xl bg-green-100 px-4 py-3 text-lg font-bold text-green-900">
                    <span className="relative flex h-4 w-4">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
                        <span className="relative inline-flex h-4 w-4 rounded-full bg-green-600" />
                    </span>
                    {copy.primary.doctorIn}
                </p>
            ) : null}

            {ended ? (
                <p className="rounded-2xl bg-gray-100 px-4 py-3 text-base text-gray-800">
                    कॉल खत्म हुई। आप फिर से जुड़ सकते हैं। / The call ended. You can join again.
                </p>
            ) : null}

            <TelemedicineConsent checked={consented} onChange={setConsented} label={GUEST_CONSENT_TEXT} senior language={shown.language} />

            <button
                type="button"
                onClick={() => void start()}
                disabled={!open || joining || !consented}
                className="flex min-h-20 w-full items-center justify-center gap-3 rounded-3xl bg-[#4b2192] px-6 text-2xl font-extrabold text-white shadow-lg transition active:scale-[0.98] disabled:opacity-50">
                <PhoneCall className="h-8 w-8" aria-hidden />
                <span>{joining ? 'जोड़ रहे हैं… / Connecting…' : `${copy.primary.start} (${copy.secondary.start})`}</span>
            </button>
            {open && !consented ? <p className="text-center text-base font-semibold text-gray-700">{GUEST_CONSENT_REQUIRED_HINT}</p> : null}
            {!open ? (
                <p className="text-center text-base text-gray-700">
                    {copy.primary.early} · {formatIstTime(info.opensAt)}
                    <span className="block text-sm text-gray-500">{copy.secondary.early}</span>
                </p>
            ) : null}
            {joinError ? <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-base font-semibold text-red-800">{joinError}</p> : null}

            <section className="space-y-3 rounded-3xl bg-[#F4F0FA] p-5" aria-label="How to join">
                <Bilingual as="h2" className="text-xl font-bold text-[#4b2192]" primary={shown.language === 'hi' ? 'कैसे जुड़ें' : 'How to join'} secondary={shown.language === 'hi' ? 'How to join' : 'कैसे जुड़ें'} />
                <ol className="space-y-3">
                    <li className="flex items-center gap-3">
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white"><Hand className="h-7 w-7 text-[#4b2192]" aria-hidden /></span>
                        <span>{shown.language === 'hi' ? 'ऊपर का बैंगनी बटन दबाएँ' : 'Tap the big purple button'}</span>
                    </li>
                    {!audioOnly ? (
                        <li className="flex items-center gap-3">
                            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white"><Camera className="h-7 w-7 text-[#4b2192]" aria-hidden /></span>
                            <span>{shown.language === 'hi' ? 'कैमरा के लिए “Allow” दबाएँ' : 'Tap “Allow” for the camera'}</span>
                        </li>
                    ) : null}
                    <li className="flex items-center gap-3">
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white"><Mic className="h-7 w-7 text-[#4b2192]" aria-hidden /></span>
                        <span>{shown.language === 'hi' ? 'माइक के लिए “Allow” दबाएँ' : 'Tap “Allow” for the microphone'}</span>
                    </li>
                    <li className="flex items-center gap-3">
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white"><CheckCircle2 className="h-7 w-7 text-green-700" aria-hidden /></span>
                        <span>{shown.language === 'hi' ? 'डॉक्टर आपको देख और सुन सकेंगे' : 'The doctor can now see and hear you'}</span>
                    </li>
                </ol>
                <p className="text-base text-gray-700">{copy.secondary.permissions}</p>
            </section>

            <p className="text-center text-sm text-gray-500">
                No app or login needed. Your family member booked this on DocNow.
            </p>
        </main>
    );
}
