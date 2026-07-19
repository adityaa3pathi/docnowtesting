/**
 * Camp Routes
 * 
 * Defines Express routers for both admin and public camp endpoints.
 * Admin routes require SUPER_ADMIN role.
 * Public routes allow unauthenticated browsing of active camps.
 * Checkout requires authentication.
 */
import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../../middleware/auth';
import { requireSuperAdmin } from '../../middleware/adminAuth';
import { rateLimiter } from '../../middleware/rateLimiter';
import {
    createCamp,
    listCamps,
    getCampById,
    updateCamp,
    updateCampItems,
    deactivateCamp,
    listActiveCamps,
} from './camps.service';
import { createCampSchema, updateCampSchema, updateCampItemsSchema } from './camps.types';
import { initiateCampCheckout } from './camps.checkout';

// ── Admin Router ────────────────────────────────────────

const adminRouter = Router();
const admin = [authMiddleware, requireSuperAdmin] as const;

/**
 * POST /api/admin/camps — Create a new camp
 */
adminRouter.post('/', ...admin, async (req: AuthRequest, res: Response) => {
    try {
        const parse = createCampSchema.safeParse(req.body);
        if (!parse.success) {
            return res.status(400).json({ error: parse.error.issues[0].message });
        }
        const camp = await createCamp(parse.data);
        res.status(201).json(camp);
    } catch (error: any) {
        console.error('[Camps] Create failed:', error.message);
        res.status(500).json({ error: error.message || 'Failed to create camp' });
    }
});

/**
 * GET /api/admin/camps — List all camps with optional filters
 */
adminRouter.get('/', ...admin, async (req: AuthRequest, res: Response) => {
    try {
        const isActive = req.query.isActive !== undefined
            ? req.query.isActive === 'true'
            : undefined;
        const city = req.query.city as string | undefined;

        const camps = await listCamps({ isActive, city });
        res.json(camps);
    } catch (error: any) {
        console.error('[Camps] List failed:', error.message);
        res.status(500).json({ error: 'Failed to list camps' });
    }
});

/**
 * GET /api/admin/camps/:id — Get camp detail
 */
adminRouter.get('/:id', ...admin, async (req: AuthRequest, res: Response) => {
    try {
        const camp = await getCampById(req.params.id as string);
        if (!camp) return res.status(404).json({ error: 'Camp not found' });
        res.json(camp);
    } catch (error: any) {
        console.error('[Camps] Get failed:', error.message);
        res.status(500).json({ error: 'Failed to get camp' });
    }
});

/**
 * PUT /api/admin/camps/:id — Update camp metadata
 */
adminRouter.put('/:id', ...admin, async (req: AuthRequest, res: Response) => {
    try {
        const parse = updateCampSchema.safeParse(req.body);
        if (!parse.success) {
            return res.status(400).json({ error: parse.error.issues[0].message });
        }
        const camp = await updateCamp(req.params.id as string, parse.data);
        res.json(camp);
    } catch (error: any) {
        console.error('[Camps] Update failed:', error.message);
        res.status(500).json({ error: error.message || 'Failed to update camp' });
    }
});

/**
 * PUT /api/admin/camps/:id/items — Replace camp catalog items
 */
adminRouter.put('/:id/items', ...admin, async (req: AuthRequest, res: Response) => {
    try {
        const parse = updateCampItemsSchema.safeParse(req.body);
        if (!parse.success) {
            return res.status(400).json({ error: parse.error.issues[0].message });
        }
        const camp = await updateCampItems(req.params.id as string, parse.data.catalogItemIds);
        res.json(camp);
    } catch (error: any) {
        console.error('[Camps] Update items failed:', error.message);
        res.status(500).json({ error: error.message || 'Failed to update camp items' });
    }
});

/**
 * DELETE /api/admin/camps/:id — Soft-delete (deactivate) a camp
 */
adminRouter.delete('/:id', ...admin, async (req: AuthRequest, res: Response) => {
    try {
        const camp = await deactivateCamp(req.params.id as string);
        res.json({ success: true, camp });
    } catch (error: any) {
        console.error('[Camps] Deactivate failed:', error.message);
        res.status(500).json({ error: error.message || 'Failed to deactivate camp' });
    }
});

// ── Public Router ───────────────────────────────────────

const publicRouter = Router();

/**
 * GET /api/camps/active — List active camps (no auth required)
 */
publicRouter.get('/active', async (_req: any, res: Response) => {
    try {
        const camps = await listActiveCamps();
        res.json(camps);
    } catch (error: any) {
        console.error('[Camps] List active failed:', error.message);
        res.status(500).json({ error: 'Failed to list camps' });
    }
});

/**
 * GET /api/camps/:id — Get camp detail (no auth required)
 */
publicRouter.get('/:id', async (req: any, res: Response) => {
    try {
        const camp = await getCampById(req.params.id);
        if (!camp) return res.status(404).json({ error: 'Camp not found' });
        if (!camp.isActive) return res.status(404).json({ error: 'Camp not found' });
        res.json(camp);
    } catch (error: any) {
        console.error('[Camps] Get public failed:', error.message);
        res.status(500).json({ error: 'Failed to get camp details' });
    }
});

/**
 * POST /api/camps/checkout — Register for a camp (auth required)
 */
publicRouter.post(
    '/checkout',
    authMiddleware,
    rateLimiter(1, 5, 'camp-checkout'),
    initiateCampCheckout
);

export { adminRouter as campAdminRoutes, publicRouter as campPublicRoutes };
