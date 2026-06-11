import { CatalogItemType, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { HealthiansAdapter } from '../adapters/healthians';

type DealType = 'package' | 'profile' | 'parameter';

interface HealthiansConstituent {
    id?: string | number;
    name?: string;
}

interface HealthiansProductData {
    id?: string | number;
    name?: string;
    fasting?: string;
    fasting_time?: string;
    reporting_time?: string;
    gender?: string;
    age_group?: string;
    description?: string;
    constituents?: HealthiansConstituent[];
    status?: string;
    source_type?: string;
}

interface ProductDetailsCache {
    id: string;
    name: string | null;
    fasting: string | null;
    fastingTime: string | null;
    reportingTime: string | null;
    gender: string[];
    ageGroup: string[];
    description: string | null;
    constituents: Array<{ id: string; name: string }>;
    status: string | null;
    sourceType: string | null;
    dealType: 'PACKAGE' | 'PROFILE' | 'PARAMETER';
}

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeString(value: unknown) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
}

function parseStringArray(value: unknown) {
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
            return parsed.map((item) => String(item).trim()).filter(Boolean);
        }
    } catch {
        // Fall back to comma splitting below.
    }
    return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function inferDealType(partnerCode: string, type: CatalogItemType): { dealType: DealType; dealTypeId: string } | null {
    const [prefix, ...rest] = partnerCode.split('_');
    const idFromCode = rest.join('_');
    if (idFromCode && ['package', 'profile', 'parameter'].includes(prefix)) {
        return { dealType: prefix as DealType, dealTypeId: idFromCode };
    }

    if (!/^\d+$/.test(partnerCode)) return null;
    if (type === 'PACKAGE') return { dealType: 'package', dealTypeId: partnerCode };
    if (type === 'PROFILE') return { dealType: 'profile', dealTypeId: partnerCode };
    return { dealType: 'parameter', dealTypeId: partnerCode };
}

function mapDetails(data: HealthiansProductData, dealType: DealType): ProductDetailsCache {
    return {
        id: String(data.id || ''),
        name: normalizeString(data.name),
        fasting: normalizeString(data.fasting),
        fastingTime: normalizeString(data.fasting_time),
        reportingTime: normalizeString(data.reporting_time),
        gender: typeof data.gender === 'string' ? data.gender.split(',').map((item) => item.trim()).filter(Boolean) : [],
        ageGroup: parseStringArray(data.age_group),
        description: normalizeString(data.description),
        constituents: Array.isArray(data.constituents)
            ? data.constituents
                .map((item) => ({ id: String(item.id || ''), name: normalizeString(item.name) || '' }))
                .filter((item) => item.name)
            : [],
        status: normalizeString(data.status),
        sourceType: normalizeString(data.source_type),
        dealType: dealType.toUpperCase() as ProductDetailsCache['dealType'],
    };
}

function isCacheFresh(item: { detailsFetchedAt?: Date | null; detailsFetchStatus?: string | null }) {
    if (item.detailsFetchStatus !== 'SUCCESS' || !item.detailsFetchedAt) return false;
    return Date.now() - item.detailsFetchedAt.getTime() < CACHE_TTL_MS;
}

function parseCachedDetails(value: Prisma.JsonValue | null | undefined): ProductDetailsCache | null {
    if (typeof value === 'string') {
        try {
            return parseCachedDetails(JSON.parse(value) as Prisma.JsonValue);
        } catch {
            return null;
        }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const details = value as unknown as ProductDetailsCache;
    return Array.isArray(details.constituents) ? details : null;
}

export function buildDetailsSummary(item: {
    type: CatalogItemType;
    parameters?: string | null;
    reportTime?: string | null;
    detailsData?: Prisma.JsonValue | null;
}) {
    const details = parseCachedDetails(item.detailsData);
    const constituents = details?.constituents || [];
    const fallbackCountMatch = item.parameters?.match(/\d+/);
    const fallbackCount = fallbackCountMatch ? Number(fallbackCountMatch[0]) : null;
    const testCount = constituents.length || fallbackCount || null;
    const reportingTime = details?.reportingTime || item.reportTime || null;
    const fastingParts = [details?.fasting, details?.fastingTime].filter(Boolean);

    return {
        testCount,
        constituentsPreview: constituents.slice(0, 6).map((item) => item.name),
        remainingConstituents: Math.max((testCount || 0) - Math.min(constituents.length, 6), 0),
        fastingLabel: fastingParts.length > 0 ? fastingParts.join(' ') : null,
        idealFor: details?.gender?.length ? details.gender.join(', ') : null,
        reportingTime,
    };
}

type CatalogItemWithCache = {
    id: string;
    partnerCode: string;
    type: CatalogItemType;
    detailsData?: Prisma.JsonValue | null;
    detailsFetchedAt?: Date | null;
    detailsFetchStatus?: string | null;
};

async function attachCatalogDetailsCache<T extends CatalogItemWithCache>(items: T[]): Promise<T[]> {
    if (items.length === 0) return items;

    const rows = await prisma.$queryRaw<Array<{
        id: string;
        detailsData: Prisma.JsonValue | null;
        detailsFetchedAt: Date | null;
        detailsFetchStatus: string | null;
    }>>(Prisma.sql`
        SELECT id, "detailsData", "detailsFetchedAt", "detailsFetchStatus"
        FROM "CatalogItem"
        WHERE id IN (${Prisma.join(items.map((item) => item.id))})
    `);

    const rowMap = new Map(rows.map((row) => [row.id, row]));
    return items.map((item) => ({ ...item, ...rowMap.get(item.id) }));
}

export async function hydrateCatalogDetails<T extends CatalogItemWithCache>(items: T[]): Promise<T[]> {
    const adapter = HealthiansAdapter.getInstance();
    const itemsWithCache = await attachCatalogDetailsCache(items);

    await Promise.all(itemsWithCache.map(async (item) => {
        if (isCacheFresh(item)) return;

        const inferred = inferDealType(item.partnerCode, item.type);
        if (!inferred) return;

        try {
            const response = await adapter.getProductDetails(inferred.dealType, inferred.dealTypeId);
            if (!response || response.status === false || !response.data) {
                await prisma.$executeRaw`
                    UPDATE "CatalogItem"
                    SET "detailsFetchStatus" = 'FAILED',
                        "detailsFetchError" = ${response?.message || 'Product details unavailable'},
                        "detailsFetchedAt" = ${new Date()}
                    WHERE id = ${item.id}
                `;
                return;
            }

            const mapped = mapDetails(response.data, inferred.dealType);
            await prisma.$executeRawUnsafe(
                `UPDATE "CatalogItem"
                 SET "detailsData" = $1::jsonb,
                     "detailsFetchStatus" = 'SUCCESS',
                     "detailsFetchError" = NULL,
                     "detailsFetchedAt" = $2
                 WHERE id = $3`,
                JSON.stringify(mapped),
                new Date(),
                item.id
            );

            item.detailsData = mapped as unknown as Prisma.JsonValue;
            item.detailsFetchStatus = 'SUCCESS';
            item.detailsFetchedAt = new Date();
        } catch (error: any) {
            await prisma.$executeRaw`
                UPDATE "CatalogItem"
                SET "detailsFetchStatus" = 'FAILED',
                    "detailsFetchError" = ${error?.message || 'Failed to fetch product details'},
                    "detailsFetchedAt" = ${new Date()}
                WHERE id = ${item.id}
            `;
        }
    }));

    return itemsWithCache;
}
