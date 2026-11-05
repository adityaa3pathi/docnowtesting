const ENTITIES: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
};

// Plain-text version of the product pages' cleaning: <br> becomes a space,
// 'na'/'n/a' counts as empty, and {City_Name} is generic since cards have no city.
function cleanText(raw?: string | null): string | null {
    if (!raw) return null;
    const text = raw
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]*>/g, '')
        .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/gi, (m) => ENTITIES[m.toLowerCase()] ?? m)
        .replace(/{City_Name}/gi, 'your city')
        .replace(/\s+/g, ' ')
        .trim();
    const lower = text.toLowerCase();
    if (!text || lower === 'na' || lower === 'n/a') return null;
    return text;
}

/** Manager-written purpose, cleaned; null when it is effectively blank. */
export function getCustomPurpose(purpose?: string | null): string | null {
    return cleanText(purpose);
}

/** Card blurb: the manager-written purpose wins; Healthians' description is the fallback. */
export function getCardSummary(
    purpose?: string | null,
    description?: string | null,
): { text: string; isCustom: boolean } | null {
    const custom = getCustomPurpose(purpose);
    if (custom) return { text: custom, isCustom: true };
    const fallback = cleanText(description);
    return fallback ? { text: fallback, isCustom: false } : null;
}

/** Label shown above the manager-written purpose, worded for the product type. */
export function getPurposeHeading(type?: string | null): string {
    if (type === 'PACKAGE') return 'What this package is for';
    if (type === 'PROFILE') return 'What this profile is for';
    return 'What this test is for';
}
