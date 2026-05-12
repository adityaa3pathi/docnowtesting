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
 * Generates a URL-friendly slug from product name and partnerCode.
 * Uses a '--' double-hyphen delimiter to separate the human-readable
 * name portion from the machine-readable partnerCode.
 * Example: "Torch-4 IgG" (partnerCode: "profile_16") -> "torch-4-igg--profile_16"
 */
export function generateProductSlug(name: string, partnerCode: string | number): string {
    const safeName = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with hyphens
        .replace(/^-+|-+$/g, '');    // Trim hyphens from start/end
        
    return `${safeName}--${partnerCode}`;
}

/**
 * Parses a slug to extract the full partnerCode and infer the dealType/dealTypeId.
 * 
 * The slug format uses a '--' double-hyphen delimiter:
 *   "torch-4-igg--profile_16" -> partnerCode = "profile_16"
 * 
 * The partnerCode encodes both the dealType and dealTypeId:
 *   "package_94"   -> dealType = "package",   dealTypeId = "94"
 *   "profile_16"   -> dealType = "profile",   dealTypeId = "16"
 *   "parameter_2"  -> dealType = "parameter", dealTypeId = "2"
 * 
 * Falls back to legacy format (last hyphen-separated segment) for
 * old URLs that don't contain the '--' delimiter.
 */
export function parseSlug(slug: string, basePath: 'packages' | 'tests'): { dealTypeId: string, dealType: 'package' | 'profile' | 'parameter' | null, partnerCode: string } {
    let partnerCode: string;

    if (slug.includes('--')) {
        // New format: everything after '--' is the raw partnerCode
        partnerCode = slug.split('--').pop()!;
    } else {
        // Legacy format: last hyphen segment is the numeric ID, infer type from basePath
        const parts = slug.split('-');
        const numericId = parts[parts.length - 1];
        const prefix = basePath === 'packages' ? 'package' : 'parameter';
        partnerCode = `${prefix}_${numericId}`;
    }

    // Extract dealType and dealTypeId from the partnerCode (e.g. "profile_16")
    const underscoreIdx = partnerCode.indexOf('_');
    let dealType: 'package' | 'profile' | 'parameter' | null = null;
    let dealTypeId: string = partnerCode;

    if (underscoreIdx !== -1) {
        const prefix = partnerCode.substring(0, underscoreIdx);
        dealTypeId = partnerCode.substring(underscoreIdx + 1);
        if (['package', 'profile', 'parameter'].includes(prefix)) {
            dealType = prefix as 'package' | 'profile' | 'parameter';
        }
    }

    return { dealTypeId, dealType, partnerCode };
}
