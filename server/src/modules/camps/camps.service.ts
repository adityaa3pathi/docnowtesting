/**
 * Camp Service — Business Logic
 * 
 * Handles all CRUD operations for health camps.
 * Used by camp admin and public route handlers.
 */
import { prisma } from '../../db';
import type { CreateCampInput, UpdateCampInput } from './camps.types';

/**
 * Create a camp with its catalog items atomically.
 */
export async function createCamp(data: CreateCampInput) {
    const { catalogItemIds, ...campData } = data;

    return prisma.$transaction(async (tx) => {
        const camp = await tx.camp.create({
            data: {
                ...campData,
                startDate: new Date(campData.startDate),
                endDate: new Date(campData.endDate),
                items: {
                    create: catalogItemIds.map((catalogItemId: string) => ({
                        catalogItemId,
                    })),
                },
            },
            include: {
                items: {
                    include: {
                        catalogItem: {
                            select: { id: true, name: true, partnerCode: true, type: true },
                        },
                    },
                },
            },
        });

        return camp;
    });
}

/**
 * List all camps with optional filters. Includes registration count.
 */
export async function listCamps(filters?: { isActive?: boolean; city?: string }) {
    const where: any = {};
    if (filters?.isActive !== undefined) where.isActive = filters.isActive;
    if (filters?.city) where.city = { contains: filters.city, mode: 'insensitive' };

    return prisma.camp.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
            _count: { select: { bookings: true } },
            items: {
                include: {
                    catalogItem: {
                        select: { id: true, name: true, partnerCode: true, type: true },
                    },
                },
            },
        },
    });
}

/**
 * Get a single camp by ID with full details.
 */
export async function getCampById(id: string) {
    return prisma.camp.findUnique({
        where: { id },
        include: {
            _count: { select: { bookings: true } },
            items: {
                include: {
                    catalogItem: {
                        select: { id: true, name: true, partnerCode: true, type: true, displayPrice: true, description: true },
                    },
                },
            },
        },
    });
}

/**
 * Update camp metadata (not items — use updateCampItems for that).
 */
export async function updateCamp(id: string, data: UpdateCampInput) {
    const updateData: any = { ...data };
    if (data.startDate) updateData.startDate = new Date(data.startDate);
    if (data.endDate) updateData.endDate = new Date(data.endDate);

    return prisma.camp.update({
        where: { id },
        data: updateData,
    });
}

/**
 * Replace all catalog items for a camp atomically.
 */
export async function updateCampItems(id: string, catalogItemIds: string[]) {
    return prisma.$transaction(async (tx) => {
        // Remove existing items
        await tx.campCatalogItem.deleteMany({ where: { campId: id } });

        // Add new items
        await tx.campCatalogItem.createMany({
            data: catalogItemIds.map(catalogItemId => ({
                campId: id,
                catalogItemId,
            })),
        });

        return tx.camp.findUnique({
            where: { id },
            include: {
                items: {
                    include: {
                        catalogItem: {
                            select: { id: true, name: true, partnerCode: true, type: true },
                        },
                    },
                },
            },
        });
    });
}

/**
 * Soft-delete a camp by marking it inactive.
 */
export async function deactivateCamp(id: string) {
    return prisma.camp.update({
        where: { id },
        data: { isActive: false },
    });
}

/**
 * List active camps with future end dates. Used for public browsing.
 */
export async function listActiveCamps() {
    const now = new Date();

    return prisma.camp.findMany({
        where: {
            isActive: true,
            endDate: { gte: now },
        },
        orderBy: { startDate: 'asc' },
        include: {
            _count: { select: { items: true } },
            items: {
                include: {
                    catalogItem: {
                        select: { id: true, name: true, type: true, partnerCode: true },
                    },
                },
            },
        },
    });
}
