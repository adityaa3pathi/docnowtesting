/**
 * searchUtils.ts — Shared search utilities for smart/fuzzy catalog search.
 *
 * Provides:
 *  - normalizeSearchTerm()  — strips special chars, lowercases
 *  - buildCatalogSearchWhere() — builds Prisma OR clause for normalized + fallback matching
 *  - fuzzyScore()           — lightweight relevance scoring
 *  - rankSearchResults()    — sorts results by relevance
 */

// ─── Normalization ──────────────────────────────────────────────────────────

/**
 * Normalize a search term by:
 *  1. Trimming whitespace
 *  2. Converting to lowercase
 *  3. Stripping all non-alphanumeric characters
 *
 * Examples:
 *  "P-19"       → "p19"
 *  "CBC Test"   → "cbctest"
 *  "Vitamin-D"  → "vitamind"
 *  "  Hello! "  → "hello"
 */
export function normalizeSearchTerm(input: string): string {
    if (!input) return '';
    return input.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ─── Prisma Where Clause Builder ────────────────────────────────────────────

/**
 * Build a Prisma-compatible `where` fragment for catalog search.
 *
 * Uses an OR condition:
 *  - searchName contains normalizedQuery (catches formatting variations)
 *  - name contains originalQuery (catches exact substring for natural language)
 *
 * Returns the OR clause to be spread into an existing `where` object.
 */
export function buildCatalogSearchWhere(search: string): { OR: any[] } {
    const trimmed = search.trim();
    const normalized = normalizeSearchTerm(trimmed);

    const conditions: any[] = [];

    // Tokenize the query: "culture swab" → ["culture", "swab"]
    const tokens = trimmed
        .toLowerCase()
        .split(/[\s\-_,&]+/)
        .map(t => t.replace(/[^a-z0-9]/g, ''))
        .filter(t => t.length > 0);

    if (tokens.length > 1) {
        // Multi-token: require ALL tokens present in searchName (AND logic)
        // "culture swab" → searchName contains "culture" AND searchName contains "swab"
        conditions.push({
            AND: tokens.map(token => ({ searchName: { contains: token } })),
        });
    } else if (normalized.length > 0) {
        // Single token: original fast path
        conditions.push({ searchName: { contains: normalized } });
    }

    // Fallback: original substring match (case-insensitive) for natural language queries
    if (trimmed.length > 0) {
        conditions.push({ name: { contains: trimmed, mode: 'insensitive' } });
    }

    // If somehow both are empty (shouldn't happen), return a no-op
    if (conditions.length === 0) {
        return { OR: [{ name: { contains: '', mode: 'insensitive' } }] };
    }

    return { OR: conditions };
}

// ─── Fuzzy Scoring ──────────────────────────────────────────────────────────

/**
 * Compute a relevance score (0–100) for a search query against a candidate name.
 *
 * Scoring tiers:
 *  100 — Exact normalized match
 *   80 — searchName starts with the normalized query
 *   60 — All tokens from the query found in the name
 *   40–59 — Partial token overlap (proportional)
 *   20 — Levenshtein boost for short queries within edit distance 2
 *    0 — No meaningful match
 */
export function fuzzyScore(query: string, candidateName: string): number {
    if (!query || !candidateName) return 0;

    const normalizedQuery = normalizeSearchTerm(query);
    const normalizedCandidate = normalizeSearchTerm(candidateName);

    if (!normalizedQuery || !normalizedCandidate) return 0;

    // Tier 1: Exact normalized match
    if (normalizedCandidate === normalizedQuery) return 100;

    // Tier 2: Candidate starts with query (e.g., "cbc" matches "CBC Test")
    if (normalizedCandidate.startsWith(normalizedQuery)) return 80;

    // Tier 3: Query is contained within candidate
    if (normalizedCandidate.includes(normalizedQuery)) return 70;

    // Tier 4: Token-level matching
    // Split the original query into tokens and check against normalized candidate
    const queryTokens = query
        .trim()
        .toLowerCase()
        .split(/[\s\-_]+/)
        .filter(Boolean)
        .map(t => t.replace(/[^a-z0-9]/g, ''))
        .filter(t => t.length > 0);

    if (queryTokens.length > 0) {
        const matchedTokens = queryTokens.filter(token =>
            normalizedCandidate.includes(token)
        );
        const matchRatio = matchedTokens.length / queryTokens.length;

        if (matchRatio === 1) return 60; // All tokens matched
        if (matchRatio > 0) return Math.round(40 + matchRatio * 19); // 40–59 proportional
    }

    // Tier 5: Levenshtein distance for short queries (typo tolerance)
    if (normalizedQuery.length <= 8 && normalizedCandidate.length <= 30) {
        const distance = levenshteinDistance(
            normalizedQuery,
            normalizedCandidate.substring(0, normalizedQuery.length + 2)
        );
        if (distance <= 1) return 25;
        if (distance <= 2) return 15;
    }

    return 0;
}

/**
 * Sort results by fuzzy relevance score (descending).
 * Items with score 0 are kept at the end in their original order.
 */
export function rankSearchResults<T extends { name: string }>(
    results: T[],
    query: string
): T[] {
    if (!query || !query.trim() || results.length === 0) return results;

    return [...results].sort((a, b) => {
        const scoreA = fuzzyScore(query, a.name);
        const scoreB = fuzzyScore(query, b.name);
        // Higher score first; if tied, preserve original order
        return scoreB - scoreA;
    });
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Compute Levenshtein edit distance between two strings.
 * Uses the standard dynamic-programming approach, optimized with a single-row buffer.
 */
function levenshteinDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;

    if (m === 0) return n;
    if (n === 0) return m;

    // Single-row DP: prev[j] represents distance from a[0..i-1] to b[0..j]
    const prev = new Array<number>(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;

    for (let i = 1; i <= m; i++) {
        let prevDiag = prev[0];
        prev[0] = i;

        for (let j = 1; j <= n; j++) {
            const temp = prev[j];
            if (a[i - 1] === b[j - 1]) {
                prev[j] = prevDiag;
            } else {
                prev[j] = 1 + Math.min(prevDiag, prev[j], prev[j - 1]);
            }
            prevDiag = temp;
        }
    }

    return prev[n];
}
