/**
 * The zero-login family call room and the three-way call layout, kept apart from React so they can
 * be tested. Room identities are `doctor:<id>`, `patient:<id>` and `caretaker:<userId>`.
 */
export type CallParty = 'doctor' | 'patient' | 'caretaker';
export type GuestLanguage = 'hi' | 'en';

export interface GuestInfo {
    status: string;
    type: 'VIDEO' | 'AUDIO' | 'CHAT';
    startsAt: string;
    endsAt: string;
    opensAt: string;
    window: 'early' | 'open';
    doctorJoined: boolean;
    patientFirstName: string;
    language: GuestLanguage;
    doctor: { name: string; photoUrl: string | null; qualification: string; specialty: string };
}

/** Who someone is from their room identity. Tokens from before three-way calls carried a bare user id. */
export function partyOf(identity: string): CallParty | null {
    const prefix = identity.split(':', 1)[0];
    return prefix === 'doctor' || prefix === 'patient' || prefix === 'caretaker' ? prefix : null;
}

/** The viewer's own party, from the role the join call returned (`patient-audio` → patient). */
export function partyOfRole(role: string): CallParty {
    const base = role.replace(/-audio$/, '');
    return base === 'doctor' || base === 'caretaker' ? base : 'patient';
}

/**
 * The big tile: the doctor for the patient side, the patient for the doctor. Everyone else is a
 * small tile. With old identities (no prefix) the first remote person is the big tile, as before.
 */
export function arrangeTiles<T extends { identity: string }>(remotes: T[], viewer: CallParty): { primary: T | undefined; others: T[] } {
    const want: CallParty = viewer === 'doctor' ? 'patient' : 'doctor';
    const primary = remotes.find((r) => partyOf(r.identity) === want) ?? remotes[0];
    return { primary, others: remotes.filter((r) => r !== primary) };
}

export const hasDoctor = (remotes: { identity: string }[]) => remotes.some((r) => partyOf(r.identity) === 'doctor');

/** Hindi and English side by side: a parent reads their language first, a helper the other. */
export function guestCopy(info: Pick<GuestInfo, 'patientFirstName' | 'doctor' | 'language'>) {
    const name = info.patientFirstName || (info.language === 'hi' ? 'जी' : 'there');
    const dr = info.doctor.name.startsWith('Dr') ? info.doctor.name : `Dr. ${info.doctor.name}`;
    const en = {
        greeting: `Namaste ${name} ji, ${dr} is ready for your consultation`,
        waiting: `Namaste ${name} ji, your consultation with ${dr} will start soon`,
        start: 'Start Call',
        permissions: 'When asked, tap "Allow" for the camera and microphone so the doctor can see and hear you.',
        doctorIn: `${dr} has joined`,
        waitingForDoctor: `Please wait, ${dr} will join shortly`,
        early: 'The room opens 10 minutes before your time',
    };
    const hi = {
        greeting: `नमस्ते ${name} जी, ${dr} आपसे परामर्श के लिए तैयार हैं`,
        waiting: `नमस्ते ${name} जी, ${dr} से आपका परामर्श जल्द शुरू होगा`,
        start: 'डॉक्टर से बात करें',
        permissions: 'पूछे जाने पर कैमरा और माइक के लिए "Allow" दबाएँ, ताकि डॉक्टर आपको देख और सुन सकें।',
        doctorIn: `${dr} आ गए हैं`,
        waitingForDoctor: `कृपया रुकें, ${dr} कुछ ही देर में जुड़ेंगे`,
        early: 'आपके समय से 10 मिनट पहले कमरा खुलेगा',
    };
    return info.language === 'hi' ? { primary: hi, secondary: en } : { primary: en, secondary: hi };
}
