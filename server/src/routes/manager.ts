import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { requireManager } from '../middleware/requireManager';
import { prisma } from '../db';
import { HealthiansAdapter } from '../adapters/healthians';
import { resolveOrCreateSelfPatient, patientSchema } from '../utils/patientValidation';
import { getRazorpay } from '../services/razorpay';
import { finalizeBooking } from '../services/bookingFinalization';

const router = Router();
const healthians = HealthiansAdapter.getInstance();

// All manager routes require auth + MANAGER/SUPER_ADMIN role
const mgr = [authMiddleware, requireManager] as const;

// Health check — verifies MANAGER/SUPER_ADMIN access for frontend auth guard
router.get('/health', ...mgr, async (req: AuthRequest, res: Response) => {
    res.json({ ok: true, manager: req.adminName || 'Manager', role: (req as any).user?.role });
});

// ============================================
// CATALOG SYNC — Import from Healthians
// ============================================

/**
 * POST /api/manager/catalog/sync
 * Fetches products from Healthians and upserts into CatalogItem.
 * New items get partnerPrice = displayPrice (manager can adjust later).
 * Existing items: only partnerPrice and metadata are updated.
 */
router.post('/catalog/sync', ...mgr, async (req: AuthRequest, res: Response) => {
    const { zipcode } = req.body;

    if (!zipcode) {
        return res.status(400).json({ error: 'zipcode is required for sync' });
    }

    try {
        const response = await healthians.getPartnerProducts(zipcode);
        const products = response?.data || response?.products || response || [];

        if (!Array.isArray(products)) {
            return res.status(400).json({ error: 'Unexpected response format from Healthians', raw: response });
        }

        let created = 0;
        let updated = 0;

        for (const product of products) {
            // Normalize Healthians response fields
            const partnerCode = String(product.deal_id || `${product.product_type}_${product.product_type_id}` || product.id);
            const name = product.test_name || product.name || product.deal_name || 'Unknown';
            const price = parseFloat(product.price || product.mrp || '0');
            const type = normalizeType(product.product_type || product.deal_type);

            const existing = await prisma.catalogItem.findUnique({
                where: { partnerCode }
            });

            if (existing) {
                // Update partner price + metadata only; keep manager overrides
                await prisma.catalogItem.update({
                    where: { partnerCode },
                    data: {
                        partnerPrice: price,
                        name: name,
                        type: type,
                        description: product.description || existing.description,
                        parameters: product.parameters || product.parameter_count?.toString() || existing.parameters,
                        sampleType: product.sample_type || existing.sampleType,
                        reportTime: product.report_time || product.report_tat || existing.reportTime,
                        partnerData: product
                    }
                });
                updated++;
            } else {
                // New item: displayPrice defaults to partner price
                await prisma.catalogItem.create({
                    data: {
                        partnerCode,
                        name,
                        type,
                        partnerPrice: price,
                        displayPrice: price,  // Default: can be overridden by manager
                        description: product.description || null,
                        parameters: product.parameters || product.parameter_count?.toString() || null,
                        sampleType: product.sample_type || null,
                        reportTime: product.report_time || product.report_tat || null,
                        partnerData: product,
                        isEnabled: true  // Products are available globally per Healthians confirmation
                    }
                });
                created++;
            }
        }

        res.json({
            message: `Sync complete: ${created} created, ${updated} updated`,
            total: products.length,
            created,
            updated
        });
    } catch (error: any) {
        console.error('[Manager] Catalog sync error:', error.message);
        res.status(500).json({ error: 'Failed to sync catalog', details: error.message });
    }
});

// ============================================
// CATALOG CRUD
// ============================================

/**
 * GET /api/manager/catalog
 * List all catalog items with filters.
 */
router.get('/catalog', ...mgr, async (req: AuthRequest, res: Response) => {
    const { type, enabled, search, page = '1', limit = '50' } = req.query;

    const where: any = {};
    if (type) where.type = type;
    if (enabled !== undefined) where.isEnabled = enabled === 'true';
    if (search) where.name = { contains: search as string, mode: 'insensitive' };

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    try {
        const [items, total] = await Promise.all([
            prisma.catalogItem.findMany({
                where,
                include: {
                    categories: {
                        include: { category: { select: { id: true, name: true, slug: true } } }
                    }
                },
                orderBy: { name: 'asc' },
                skip,
                take: parseInt(limit as string)
            }),
            prisma.catalogItem.count({ where })
        ]);

        res.json({ items, total, page: parseInt(page as string), limit: parseInt(limit as string) });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to fetch catalog', details: error.message });
    }
});

/**
 * PUT /api/manager/catalog/:id
 * Update a catalog item (price, discount, enable/disable, metadata).
 */
router.put('/catalog/:id', ...mgr, async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const { displayPrice, discountedPrice, isEnabled, name, description, parameters, sampleType, reportTime, type } = req.body;

    try {
        const existing = await prisma.catalogItem.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ error: 'Catalog item not found' });

        const data: any = {};
        if (displayPrice !== undefined) data.displayPrice = parseFloat(displayPrice);
        if (discountedPrice !== undefined) data.discountedPrice = discountedPrice === null ? null : parseFloat(discountedPrice);
        if (isEnabled !== undefined) data.isEnabled = Boolean(isEnabled);
        if (name !== undefined) data.name = name;
        if (description !== undefined) data.description = description;
        if (parameters !== undefined) data.parameters = parameters;
        if (sampleType !== undefined) data.sampleType = sampleType;
        if (reportTime !== undefined) data.reportTime = reportTime;
        if (type !== undefined) data.type = type;

        const updated = await prisma.catalogItem.update({
            where: { id },
            data,
            include: {
                categories: {
                    include: { category: { select: { id: true, name: true } } }
                }
            }
        });

        res.json(updated);
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to update catalog item', details: error.message });
    }
});

/**
 * PUT /api/manager/catalog/:id/toggle
 * Quick enable/disable toggle.
 */
router.put('/catalog/:id/toggle', ...mgr, async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;

    try {
        const existing = await prisma.catalogItem.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ error: 'Catalog item not found' });

        const updated = await prisma.catalogItem.update({
            where: { id },
            data: { isEnabled: !existing.isEnabled }
        });

        res.json({ id: updated.id, name: updated.name, isEnabled: updated.isEnabled });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to toggle item', details: error.message });
    }
});

// ============================================
// CATEGORY CRUD
// ============================================

/**
 * POST /api/manager/categories
 */
router.post('/categories', ...mgr, async (req: AuthRequest, res: Response) => {
    const { name, description, sortOrder } = req.body;

    if (!name) return res.status(400).json({ error: 'Category name is required' });

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    try {
        const category = await prisma.category.create({
            data: { name, slug, description: description || null, sortOrder: sortOrder || 0 }
        });
        res.status(201).json(category);
    } catch (error: any) {
        if (error.code === 'P2002') {
            return res.status(409).json({ error: 'Category with this name already exists' });
        }
        res.status(500).json({ error: 'Failed to create category', details: error.message });
    }
});

/**
 * GET /api/manager/categories
 */
router.get('/categories', ...mgr, async (req: AuthRequest, res: Response) => {
    try {
        const categories = await prisma.category.findMany({
            include: {
                items: {
                    include: {
                        catalogItem: { select: { id: true, name: true, partnerCode: true, isEnabled: true } }
                    },
                    orderBy: { sortOrder: 'asc' }
                }
            },
            orderBy: { sortOrder: 'asc' }
        });

        // Add item count
        const result = categories.map(cat => ({
            ...cat,
            itemCount: cat.items.length,
            enabledItemCount: cat.items.filter(i => i.catalogItem.isEnabled).length
        }));

        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to fetch categories', details: error.message });
    }
});

/**
 * PUT /api/manager/categories/:id
 */
router.put('/categories/:id', ...mgr, async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const { name, description, sortOrder, isActive } = req.body;

    try {
        const data: any = {};
        if (name !== undefined) {
            data.name = name;
            data.slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        }
        if (description !== undefined) data.description = description;
        if (sortOrder !== undefined) data.sortOrder = sortOrder;
        if (isActive !== undefined) data.isActive = Boolean(isActive);

        const updated = await prisma.category.update({ where: { id }, data });
        res.json(updated);
    } catch (error: any) {
        if (error.code === 'P2025') return res.status(404).json({ error: 'Category not found' });
        res.status(500).json({ error: 'Failed to update category', details: error.message });
    }
});

/**
 * DELETE /api/manager/categories/:id
 */
router.delete('/categories/:id', ...mgr, async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;

    try {
        await prisma.category.delete({ where: { id } });
        res.json({ message: 'Category deleted' });
    } catch (error: any) {
        if (error.code === 'P2025') return res.status(404).json({ error: 'Category not found' });
        res.status(500).json({ error: 'Failed to delete category', details: error.message });
    }
});

// ============================================
// CATEGORY ↔ ITEM ASSIGNMENT
// ============================================

/**
 * POST /api/manager/categories/:id/items
 * Body: { itemIds: string[] }
 */
router.post('/categories/:id/items', ...mgr, async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const { itemIds } = req.body;

    if (!Array.isArray(itemIds) || itemIds.length === 0) {
        return res.status(400).json({ error: 'itemIds array is required' });
    }

    try {
        const category = await prisma.category.findUnique({ where: { id } });
        if (!category) return res.status(404).json({ error: 'Category not found' });

        // Upsert to avoid duplicates
        const results = await Promise.all(
            itemIds.map(catalogItemId =>
                prisma.catalogItemCategory.upsert({
                    where: {
                        catalogItemId_categoryId: { catalogItemId, categoryId: id }
                    },
                    create: { catalogItemId, categoryId: id },
                    update: {}
                })
            )
        );

        res.json({ message: `${results.length} items assigned to category "${category.name}"` });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to assign items', details: error.message });
    }
});

/**
 * DELETE /api/manager/categories/:id/items
 * Body: { itemIds: string[] }
 */
router.delete('/categories/:id/items', ...mgr, async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const { itemIds } = req.body;

    if (!Array.isArray(itemIds) || itemIds.length === 0) {
        return res.status(400).json({ error: 'itemIds array is required' });
    }

    try {
        const deleted = await prisma.catalogItemCategory.deleteMany({
            where: {
                categoryId: id,
                catalogItemId: { in: itemIds }
            }
        });

        res.json({ message: `${deleted.count} items removed from category` });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to remove items', details: error.message });
    }
});

// ============================================
// HELPERS
// ============================================

function normalizeType(dealType?: string): 'TEST' | 'PACKAGE' | 'PROFILE' {
    if (!dealType) return 'TEST';
    const t = dealType.toLowerCase();
    if (t === 'package' || t === 'combo') return 'PACKAGE';
    if (t === 'profile') return 'PROFILE';
    return 'TEST';
}

// ============================================
// MANAGER ORDER FLOW
// ============================================

// A. User Search
router.get('/users/search', ...mgr, async (req: AuthRequest, res: Response) => {
    const mobile = req.query.mobile as string;
    if (!mobile || typeof mobile !== 'string') return res.status(400).json({ error: 'mobile query param required' });
    try {
        const users = await prisma.user.findMany({
            where: { mobile: { contains: mobile } },
            select: { id: true, name: true, mobile: true },
            take: 10
        });
        res.json(users);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// B. Patient CRUD
router.get('/users/:userId/patients', ...mgr, async (req: AuthRequest, res: Response) => {
    const userId = req.params.userId as string;
    try {
        const patients = await prisma.patient.findMany({
            where: { userId, relation: { notIn: ['Self', 'self'] } }
        });
        res.json(patients);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/users/:userId/patients', ...mgr, async (req: AuthRequest, res: Response) => {
    const userId = req.params.userId as string;
    try {
        const validated = patientSchema.parse(req.body);
        const patient = await prisma.patient.create({
            data: { ...validated, userId }
        });
        res.status(201).json(patient);
    } catch (error: any) {
        res.status(400).json({ error: error.errors || error.message });
    }
});

router.put('/users/:userId/patients/:id', ...mgr, async (req: AuthRequest, res: Response) => {
    const userId = req.params.userId as string;
    const id = req.params.id as string;
    try {
        const validated = patientSchema.parse(req.body);
        const patient = await prisma.patient.update({
            where: { id, userId },
            data: validated
        });
        res.json(patient);
    } catch (error: any) {
        res.status(400).json({ error: error.errors || error.message });
    }
});

// C. Address Fetch
router.get('/users/:userId/addresses', ...mgr, async (req: AuthRequest, res: Response) => {
    const userId = req.params.userId as string;
    try {
        const addresses = await prisma.address.findMany({ where: { userId } });
        res.json(addresses);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// D. Slot Fetch
router.post('/slots', ...mgr, async (req: AuthRequest, res: Response) => {
    const { lat, long, zipcode, date, items } = req.body;
    try {
        const response = await healthians.getSlotsByLocation({
            lat,
            long,
            zipcode,
            zone_id: '',
            slot_date: date,
            amount: 0,
            package: (items || []).map((i: any) => ({ deal_id: [i.testCode] }))
        });
        const results = Array.isArray(response) ? response : (response.data || response.slots || response || []);
        res.json(results);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// E. Order Creation
router.post('/orders', ...mgr, async (req: AuthRequest, res: Response) => {
    const { userId, addressId, slotDate, slotTime, items } = req.body;
    const managerId = req.userId!;

    if (!userId || !addressId || !slotDate || !slotTime || !items || !items.length) {
        return res.status(400).json({ error: 'Missing required order fields' });
    }

    try {
        const address = await prisma.address.findUnique({ where: { id: addressId } });
        if (!address) return res.status(404).json({ error: 'Address not found' });

        let totalAmount = 0;
        const catalogItems = await prisma.catalogItem.findMany({
            where: { partnerCode: { in: items.map((i: any) => i.testCode) } }
        });
        const catalogMap = new Map(catalogItems.map(c => [c.partnerCode, c]));

        const finalItems: Array<{testCode: string, testName: string, price: number, patientId: string}> = [];
        for (const item of items) {
            const cat = catalogMap.get(item.testCode);
            if (!cat) throw new Error(`Test code not found: ${item.testCode}`);
            const price = Math.max(0, cat.discountedPrice ?? cat.displayPrice);
            totalAmount += price;
            finalItems.push({
                testCode: item.testCode,
                testName: cat.name,
                price: price,
                patientId: item.patientId
            });
        }

        const result = await prisma.$transaction(async (tx) => {
            const resolvedItems: Array<any> = [];
            for (const item of finalItems) {
                let pId = item.patientId;
                if (pId === 'self') {
                    const selfPatient = await resolveOrCreateSelfPatient(userId, tx as any);
                    pId = selfPatient.id;
                }
                resolvedItems.push({ ...item, patientId: pId });
            }

            const booking = await tx.booking.create({
                data: {
                    userId,
                    addressId: address.id,
                    createdByManagerId: managerId,
                    paymentStatus: 'INITIATED',
                    status: 'Awaiting Payment',
                    finalAmount: totalAmount,
                    totalAmount: totalAmount,
                    slotDate: new Date(slotDate).toISOString(),
                    slotTime,
                    addressLine: address.line1,
                    addressCity: address.city,
                    addressPincode: address.pincode,
                    addressLat: address.lat || "0",
                    addressLong: address.long || "0",
                    items: { create: resolvedItems }
                }
            });

            const managerOrder = await tx.managerOrder.create({
                data: {
                    bookingId: booking.id,
                    managerId,
                    customerId: userId,
                    totalAmount,
                    status: 'CREATED'
                }
            });

            return { booking, managerOrder };
        });

        res.status(201).json(result);
    } catch (error: any) {
        console.error('[Manager] Order creation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// F. Payment Link
router.post('/orders/:id/payment-link', ...mgr, async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string; 
    try {
        const order = await prisma.managerOrder.findUnique({
            where: { id },
            include: { booking: { include: { user: true } }, customer: true }
        });
        if (!order) return res.status(404).json({ error: 'Order not found' });
        if (order.status !== 'CREATED' && order.status !== 'SENT') {
            return res.status(400).json({ error: 'Order already processed or failed' });
        }

        const plink = await getRazorpay().paymentLink.create({
            amount: Math.round(order.totalAmount * 100),
            currency: 'INR',
            accept_partial: false,
            description: `Payment for Booking ${order.bookingId}`,
            customer: {
                name: order.customer.name || 'Customer',
                contact: order.customer.mobile || undefined,
                email: order.customer.email || undefined
            },
            notify: { sms: true, email: !!order.customer.email },
            reminder_enable: true,
            notes: { bookingId: order.bookingId, managerOrderId: order.id }
        });

        await prisma.managerOrder.update({
            where: { id },
            data: { 
                status: 'SENT',
                razorpayLinkId: plink.id,
                razorpayLinkUrl: plink.short_url
            }
        });

        res.json({ linkId: plink.id, shortUrl: plink.short_url, status: plink.status });
    } catch (error: any) {
        console.error('[Manager] Create payment link error:', error);
        res.status(500).json({ error: error.message });
    }
});

// G. Mark as Paid
router.post('/orders/:id/confirm-payment', ...mgr, async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const { collectionMode } = req.body;
    
    if (!['RAZORPAY_LINK', 'OFFLINE_CASH', 'OFFLINE_UPI'].includes(collectionMode)) {
        return res.status(400).json({ error: 'Invalid collection mode' });
    }

    try {
        const order = await prisma.managerOrder.findUnique({
            where: { id },
            include: { booking: true }
        });
        if (!order) return res.status(404).json({ error: 'Order not found' });

        if (collectionMode === 'RAZORPAY_LINK') {
            if (order.status !== 'PAYMENT_RECEIVED') {
                return res.status(400).json({
                    error: 'Cannot confirm Razorpay link payment: no verified payment received yet. Wait for the customer to pay via the link.',
                    code: 'PAYMENT_NOT_RECEIVED'
                });
            }
        } else {
            if (!['CREATED', 'SENT', 'PAYMENT_RECEIVED'].includes(order.status)) {
                return res.status(400).json({ error: 'Order cannot be confirmed in current state' });
            }
        }

        await prisma.$transaction(async (tx) => {
            await tx.managerOrder.update({
                where: { id },
                data: {
                    status: 'PAYMENT_CONFIRMED',
                    collectionMode: collectionMode as any,
                    confirmedAt: new Date()
                }
            });
            await tx.booking.update({
                where: { id: order.bookingId },
                data: {
                    paymentStatus: 'AUTHORIZED',
                    paidAt: order.booking.paidAt || new Date()
                }
            });
        });

        const result = await finalizeBooking(order.bookingId);

        if (result.status === 'success' || result.status === 'already_confirmed') {
            await prisma.managerOrder.update({
                where: { id },
                data: { status: 'CONFIRMED' }
            });
            await prisma.cartItem.deleteMany({ where: { cart: { userId: order.customerId } } });
            res.json({ status: 'success', managerOrder: id, bookingId: order.bookingId });
        } else {
            await prisma.managerOrder.update({
                where: { id },
                data: { status: 'BOOKING_FAILED' }
            });
            res.status(200).json({ 
                status: 'payment_received_booking_pending', 
                message: 'Payment registered, but partner booking failed. Will enqueue retry.' 
            });
        }
    } catch (error: any) {
        console.error('[Manager] Confirm payment error:', error);
        res.status(500).json({ error: error.message });
    }
});

// H. List Orders
router.get('/orders', ...mgr, async (req: AuthRequest, res: Response) => {
    const { status, page = '1', limit = '50' } = req.query;
    try {
        const orders = await prisma.managerOrder.findMany({
            where: {
                managerId: req.userId,
                ...(status ? { status: status as any } : {})
            },
            include: {
                booking: { select: { status: true, paymentStatus: true, partnerBookingId: true } },
                customer: { select: { name: true, mobile: true } }
            },
            orderBy: { createdAt: 'desc' },
            skip: (parseInt(page as string) - 1) * parseInt(limit as string),
            take: parseInt(limit as string)
        });
        res.json(orders);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
