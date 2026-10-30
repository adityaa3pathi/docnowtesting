/**
 * Doctor matching for the homepage search, kept apart from React so it can be tested. Keep in step
 * with the mobile app's lib/consult/doctorSearch.ts.
 */
import type { DoctorSummary } from './types';

/** Everyday words people type, mapped to the specialties that treat them (matched on slug and name). */
const SYMPTOMS: { words: RegExp; specialty: RegExp }[] = [
    { words: /fever|cold|cough|flu|viral|infection|weakness|body ?ache|general/, specialty: /general|physician|family|internal/ },
    { words: /skin|rash|acne|pimple|itch|eczema|hair ?(fall|loss)|dandruff|derma/, specialty: /derma|skin/ },
    { words: /child|baby|infant|kid|toddler|vaccin/, specialty: /pa?ediat|child|neonat/ },
    { words: /period|pregnan|pcos|pcod|menstru|fertility|gyn/, specialty: /gyn|obst|women/ },
    { words: /heart|chest pain|palpitation|\bbp\b|blood pressure|hypertension|cardi/, specialty: /cardi|heart/ },
    { words: /joint|knee|back ?pain|neck pain|bone|fracture|arthritis|sprain|ortho/, specialty: /ortho|bone|joint/ },
    { words: /headache|migraine|seizure|epilep|numb|stroke|neuro/, specialty: /neuro/ },
    { words: /anxiety|depress|stress|sleep|insomnia|mental|panic/, specialty: /psych|mental/ },
    { words: /diabet|sugar|thyroid|hormone|obesity|weight/, specialty: /diabet|endocr|thyroid|general|physician/ },
    { words: /stomach|acidity|gas|constipation|diarr|vomit|liver|digest|gastro/, specialty: /gastro|liver|digest|general|physician/ },
    { words: /breath|asthma|wheez|lung/, specialty: /pulmo|chest|lung|respir/ },
    { words: /\beye|vision|ophthal/, specialty: /ophthal|eye/ },
    { words: /\bear|throat|nose|sinus|tonsil/, specialty: /\bent\b|ear|nose|throat|otolaryn/ },
    { words: /tooth|teeth|gum|dental|dent/, specialty: /dent/ },
];

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Doctors whose name, specialty or qualification contain the query, then those treating a symptom in it. */
export function searchDoctors(doctors: DoctorSummary[], query: string): DoctorSummary[] {
    const q = norm(query).replace(/^dr\.?\s*/, '');
    if (!q) return doctors;
    const bySymptom = SYMPTOMS.filter((s) => s.words.test(q)).map((s) => s.specialty);
    const direct: DoctorSummary[] = [];
    const related: DoctorSummary[] = [];
    for (const d of doctors) {
        const text = norm(`${d.displayName} ${d.specialty.name} ${d.specialty.slug.replace(/-/g, ' ')} ${d.qualification}`);
        if (text.includes(q)) direct.push(d);
        else if (bySymptom.some((re) => re.test(norm(`${d.specialty.slug} ${d.specialty.name}`)))) related.push(d);
    }
    return [...direct, ...related];
}
