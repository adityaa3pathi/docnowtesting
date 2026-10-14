const ENTITIES: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
};

// Same rules as the product pages: <br> becomes a space, 'na'/'n/a' counts as empty.
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

/** Card blurb: the manager-written purpose wins; Healthians' description is the fallback. */
export function getCardSummary(purpose?: string | null, description?: string | null): string | null {
    return cleanText(purpose) ?? cleanText(description);
}
