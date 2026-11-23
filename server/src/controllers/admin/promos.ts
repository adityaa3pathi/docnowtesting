import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { PromoAppliesTo, Prisma } from '@prisma/client';

const APPLIES_TO: PromoAppliesTo[] = ['LAB', 'CONSULT', 'BOTH'];
const MAX_SCOPES = 200;
const scopeInclude = {
    scopes: { select: { doctorId: true, specialtyId: true, doctor: { select: { displayName: true } }, specialty: { select: { name: true } } } },
} satisfies Prisma.PromoCodeInclude;

class ScopeError extends Error {}

/**
 * Reads "applies to" and the doctor / specialty limits from a request body. Limits are for
 * consultations only, so a LAB code can't have any. Unknown ids are refused, not dropped.
 * `undefined` fields mean "leave as is" (for edits).
 */
async function readScope(body: any): Promise<{ appliesTo?: PromoAppliesTo; doctorIds?: string[]; specialtyIds?: string[] }> {
    const appliesTo = body.appliesTo === undefined ? undefined : body.appliesTo;
    if (appliesTo !== undefined && !APPLIES_TO.includes(appliesTo)) throw new ScopeError('appliesTo must be LAB, CONSULT or BOTH');
    const ids = (v: unknown, name: string) => {
        if (v === undefined) return undefined;
        if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !/^[0-9a-f-]{36}$/i.test(x))) throw new ScopeError(`${name} must be a list of ids`);
        return [...new Set(v as string[])];
    };
    const doctorIds = ids(body.doctorIds, 'doctorIds');
    const specialtyIds = ids(body.specialtyIds, 'specialtyIds');
    if ((doctorIds?.length ?? 0) + (specialtyIds?.length ?? 0) > MAX_SCOPES) throw new ScopeError(`At most ${MAX_SCOPES} doctors and specialties`);
    if (doctorIds?.length && (await prisma.doctorProfile.count({ where: { id: { in: doctorIds } } })) !== doctorIds.length) throw new ScopeError('Unknown doctor');
    if (specialtyIds?.length && (await prisma.specialty.count({ where: { id: { in: specialtyIds } } })) !== specialtyIds.length) throw new ScopeError('Unknown specialty');
    return { appliesTo, doctorIds, specialtyIds };
}

const scopeRows = (doctorIds: string[] = [], specialtyIds: string[] = []): { doctorId: string | null; specialtyId: string | null }[] => [
    ...doctorIds.map((doctorId) => ({ doctorId, specialtyId: null })),
    ...specialtyIds.map((specialtyId) => ({ doctorId: null, specialtyId })),
];

/**
 * GET /api/admin/promos — List all promo codes (paginated)
 */
export async function listPromos(req: AuthRequest, res: Response) {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;

        const promos = await prisma.promoCode.findMany({
            skip: (page - 1) * limit,
            take: limit,
            orderBy: { createdAt: 'desc' },
            include: scopeInclude,
        });

        const total = await prisma.promoCode.count();

        res.json({
            promos,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    } catch (error) {
        console.error('[Admin] Error fetching promos:', error);
        res.status(500).json({ error: 'Failed to fetch promos' });
    }
}

/**
 * POST /api/admin/promos — Create new promo code
 */
export async function createPromo(req: AuthRequest, res: Response) {
    try {
        const {
            code, description, discountType, discountValue,
            maxDiscount, minOrderValue, maxRedemptions, maxPerUser,
            startsAt, expiresAt
        } = req.body;

        // Basic Validation
        if (!code || !discountType || !discountValue) {
            return res.status(400).json({ error: 'Missing required fields: code, discountType, discountValue' });
        }

        if (!['PERCENTAGE', 'FLAT'].includes(discountType)) {
            return res.status(400).json({ error: 'discountType must be PERCENTAGE or FLAT' });
        }

        const scope = await readScope(req.body);
        const appliesTo = scope.appliesTo ?? 'LAB';
        const rows = scopeRows(scope.doctorIds, scope.specialtyIds);
        if (appliesTo === 'LAB' && rows.length > 0) {
            return res.status(400).json({ error: 'Doctor and specialty limits are for consultation codes' });
        }

        const promo = await prisma.promoCode.create({
            data: {
                code: code.trim().toUpperCase(),
                description: description || null,
                discountType,
                discountValue: parseFloat(discountValue),
                maxDiscount: maxDiscount ? parseFloat(maxDiscount) : null,
                minOrderValue: minOrderValue ? parseFloat(minOrderValue) : 0,
                maxRedemptions: maxRedemptions ? parseInt(maxRedemptions) : null,
                maxPerUser: maxPerUser ? parseInt(maxPerUser) : 1,
                startsAt: startsAt ? new Date(startsAt) : new Date(),
                expiresAt: expiresAt ? new Date(expiresAt) : null,
                isActive: true,
                appliesTo,
                ...(rows.length ? { scopes: { create: rows } } : {}),
            },
            include: scopeInclude,
        });

        // Audit Log
        await prisma.adminAuditLog.create({
            data: {
                adminId: req.userId!,
                adminName: req.adminName!,
                action: 'CREATE',
                entity: 'PromoCode',
                targetId: promo.id,
                newValue: { code: promo.code, discountType: promo.discountType, discountValue: promo.discountValue, appliesTo, doctorIds: scope.doctorIds ?? [], specialtyIds: scope.specialtyIds ?? [] }
            }
        });

        res.status(201).json(promo);
    } catch (error) {
        if (error instanceof ScopeError) return res.status(400).json({ error: error.message });
        console.error('[Admin] Error creating promo:', error);
        res.status(500).json({ error: 'Failed to create promo' });
    }
}

/**
 * PUT /api/admin/promos/:id — Update promo (Toggle Status / Expiry)
 */
export async function updatePromo(req: AuthRequest, res: Response) {
    try {
        const id = req.params.id as string;
        const { isActive, expiresAt, maxPerUser } = req.body;
        const scope = await readScope(req.body);
        const replaceScopes = scope.doctorIds !== undefined || scope.specialtyIds !== undefined;

        const promo = await prisma.$transaction(async (tx) => {
            const current = await tx.promoCode.findUniqueOrThrow({ where: { id }, include: { scopes: true } });
            const appliesTo = scope.appliesTo ?? current.appliesTo;
            const rows = replaceScopes
                ? scopeRows(scope.doctorIds ?? current.scopes.flatMap((s) => (s.doctorId ? [s.doctorId] : [])), scope.specialtyIds ?? current.scopes.flatMap((s) => (s.specialtyId ? [s.specialtyId] : [])))
                : current.scopes;
            if (appliesTo === 'LAB' && rows.length > 0) throw new ScopeError('Doctor and specialty limits are for consultation codes');
            if (replaceScopes) {
                await tx.promoCodeScope.deleteMany({ where: { promoCodeId: id } });
                if (rows.length) await tx.promoCodeScope.createMany({ data: rows.map((r) => ({ promoCodeId: id, doctorId: r.doctorId, specialtyId: r.specialtyId })) });
            }
            return tx.promoCode.update({
                where: { id },
                data: {
                    isActive: isActive !== undefined ? isActive : undefined,
                    expiresAt: expiresAt ? new Date(expiresAt) : undefined,
                    maxPerUser: maxPerUser !== undefined ? parseInt(maxPerUser) : undefined,
                    appliesTo: scope.appliesTo,
                },
                include: scopeInclude,
            });
        });

        // Audit Log
        await prisma.adminAuditLog.create({
            data: {
                adminId: req.userId!,
                adminName: req.adminName!,
                action: 'UPDATE',
                entity: 'PromoCode',
                targetId: promo.id,
                newValue: {
                    isActive: promo.isActive, expiresAt: promo.expiresAt, appliesTo: promo.appliesTo,
                    doctorIds: promo.scopes.flatMap((s) => (s.doctorId ? [s.doctorId] : [])),
                    specialtyIds: promo.scopes.flatMap((s) => (s.specialtyId ? [s.specialtyId] : [])),
                }
            }
        });

        res.json(promo);
    } catch (error) {
        if (error instanceof ScopeError) return res.status(400).json({ error: error.message });
        console.error('[Admin] Error updating promo:', error);
        res.status(500).json({ error: 'Failed to update promo' });
    }
}

/**
 * DELETE /api/admin/promos/:id — Delete promo
 */
export async function deletePromo(req: AuthRequest, res: Response) {
    try {
        const id = req.params.id as string;

        try {
            await prisma.promoCode.delete({ where: { id } });

            // Audit Log
            await prisma.adminAuditLog.create({
                data: {
                    adminId: req.userId!,
                    adminName: req.adminName!,
                    action: 'DELETE',
                    entity: 'PromoCode',
                    targetId: id,
                    isDestructive: true
                }
            });

            res.json({ success: true });
        } catch (error: any) {
            if (error.code === 'P2003') {
                return res.status(400).json({ error: 'Cannot delete this promo code because it has already been used. Please deactivate it instead.' });
            }
            throw error;
        }
    } catch (error) {
        console.error('[Admin] Error deleting promo:', error);
        res.status(500).json({ error: 'Failed to delete promo' });
    }
}

