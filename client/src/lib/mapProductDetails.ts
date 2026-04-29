import { HealthiansProductData, ProductDetailsViewModel } from '../types/productDetails';

/**
 * Normalizes empty strings or missing values to null
 */
function normalizeString(val: string | null | undefined): string | null {
    if (!val || val.trim() === '') return null;
    return val.trim();
}

/**
 * Maps the raw Healthians product details API response to our UI ViewModel
 */
export function mapHealthiansResponseToViewModel(
    data: HealthiansProductData,
    dealType: 'PACKAGE' | 'PROFILE' | 'PARAMETER'
): ProductDetailsViewModel {
    
    // Parse age_group (e.g. "[\"5-99\"]" -> ["5-99"])
    let ageGroup: string[] = [];
    try {
        if (data.age_group) {
            ageGroup = JSON.parse(data.age_group);
        }
    } catch (e) {
        console.warn('Failed to parse age_group:', data.age_group);
        ageGroup = [data.age_group]; // fallback to raw string
    }

    // Parse gender (e.g. "Male,Female" -> ["Male", "Female"])
    let gender: string[] = [];
    if (data.gender) {
        gender = data.gender.split(',').map(g => g.trim()).filter(Boolean);
    }

    return {
        id: data.id,
        name: data.name,
        fasting: normalizeString(data.fasting),
        fastingTime: normalizeString(data.fasting_time),
        reportingTime: normalizeString(data.reporting_time),
        gender,
        ageGroup,
        description: normalizeString(data.description),
        constituents: data.constituents?.map(c => ({
            id: c.id,
            name: c.name
        })) || [],
        status: data.status,
        sourceType: normalizeString(data.source_type),
        dealType
    };
}

/**
 * Generates a URL-friendly slug from product name and IDs
 * Format: name-slugified-dealTypeId
 * Example: "Anaemia Package-old" (dealTypeId: 94) -> "anaemia-package-old-94"
 */
export function generateProductSlug(name: string, dealTypeId: string | number): string {
    const safeName = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with hyphens
        .replace(/^-+|-+$/g, '');    // Trim hyphens from start/end
        
    return `${safeName}-${dealTypeId}`;
}

/**
 * Parses a slug to extract the dealTypeId.
 * For now, partnerCode is assumed to be `<dealType>_<dealTypeId>`, but we don't have
 * dealType in the slug unless we infer it. 
 * Since the user will navigate from a list that already has the partnerCode, 
 * we just need to ensure the routing works.
 * 
 * Our local DB stores `partnerCode` as `package_94`.
 * If we just have the slug `anaemia-package-old-94`, we extract `94`.
 * We can guess the dealType if the slug contains 'package' or 'profile', but 
 * it's better to pass it or rely on the local DB lookup.
 * 
 * Wait! To hit our local DB `/api/catalog/products/:code`, we need the full `partnerCode` (e.g. `package_94`).
 * If we extract `94`, how do we know if it's a `package_94` or `profile_94`?
 * We can look it up in the local DB by `partnerCode: { endsWith: '_94' }` but that might not be unique.
 * Or we can enforce the URL pattern to include the type: `/packages/anaemia-package-old-94` 
 * If they are in `/packages/[slug]`, the dealType is 'package'.
 * If they are in `/tests/[slug]`, it could be 'profile' or 'parameter'.
 */
export function parseSlug(slug: string, basePath: 'packages' | 'tests'): { dealTypeId: string, dealType: 'package' | 'profile' | 'parameter' | null } {
    const parts = slug.split('-');
    const dealTypeId = parts[parts.length - 1]; // The last part is the ID
    
    let dealType: 'package' | 'profile' | 'parameter' | null = null;
    
    if (basePath === 'packages') {
        dealType = 'package';
    } else if (basePath === 'tests') {
        // We can't strictly know if it's profile or parameter just from the ID.
        // We might need to try both or rely on the local DB to tell us.
        // For now, we return null and let the page fetch the local DB first to get the true dealType.
        dealType = null;
    }

    return { dealTypeId, dealType };
}
