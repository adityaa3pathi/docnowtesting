/**
 * Text for messages to a family member's own phone (WhatsApp), in their preferred language.
 * The prescription pad writes dosage in English ("1-0-1 (morning, night)", "After Food",
 * "5 Days"); this turns the common parts into simple Hindi so a parent can follow it.
 */
export type FamilyLanguage = 'hi' | 'en';

import { medicineParts, type StoredMedicine } from './consultations.medicine';

const HINDI: [RegExp, string][] = [
    [/\bmorning\b/gi, 'सुबह'],
    [/\bafternoon\b/gi, 'दोपहर'],
    [/\bnight\b/gi, 'रात'],
    [/\bonly when needed\b/gi, 'ज़रूरत होने पर'],
    [/\bafter food\b/gi, 'खाने के बाद'],
    [/\bbefore food\b/gi, 'खाने से पहले'],
    [/\bwith food\b/gi, 'खाने के साथ'],
    [/\bempty stomach\b/gi, 'खाली पेट'],
    [/\bdays?\b/gi, 'दिन'],
    [/\bweeks?\b/gi, 'हफ़्ते'],
    [/\bmonths?\b/gi, 'महीने'],
];

export function localizeDosage(text: string, lang: FamilyLanguage): string {
    if (lang === 'en' || !text) return text;
    return HINDI.reduce((t, [re, hi]) => t.replace(re, hi), text);
}

/** WhatsApp template parameters are limited; long prescriptions end with "+N more". */
export const SUMMARY_MAX = 600;

/** "1. Paracetamol 650mg: 1-0-1 (सुबह, रात), खाने के बाद, 5 दिन" — one line per medicine. */
export function dosageSummary(medicines: StoredMedicine[], lang: FamilyLanguage): string {
    if (!medicines.length) return lang === 'hi' ? 'कोई दवा नहीं लिखी गई।' : 'No medicines prescribed.';
    const lines: string[] = [];
    let used = 0;
    for (const [i, m] of medicines.entries()) {
        const p = medicineParts(m);
        const how = [p.dose, p.when, p.food, p.instructions, p.duration].filter(Boolean).map((x) => localizeDosage(x, lang)).join(', ');
        const line = `${i + 1}. ${p.title}${how ? `: ${how}` : ''}`;
        if (used + line.length > SUMMARY_MAX) {
            const rest = medicines.length - i;
            lines.push(lang === 'hi' ? `+${rest} और` : `+${rest} more`);
            break;
        }
        lines.push(line);
        used += line.length + 1;
    }
    // WhatsApp template text cannot contain new lines in parameters; " | " keeps lines apart.
    return lines.join(' | ');
}
