import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { requireManager } from '../middleware/requireManager';
import { prisma } from '../db';
import { z } from 'zod';
import { HealthiansAdapter } from '../adapters/healthians';
import { resolveOrCreateSelfPatient, patientSchema } from '../utils/patientValidation';
import { getRazorpay } from '../services/razorpay';
import { finalizeBooking } from '../services/bookingFinalization';
import { cancelGlobalBookingAsManager, cancelManagerOrder } from '../services/bookingCancellation';
import { generateReferralCode } from '../utils/referralService';
import { getClientIP } from '../utils/adminHelpers';
import { getGeodataFromPincode } from '../utils/geocoding';
import { listCallbacks, updateCallbackStatus } from '../controllers/admin/callbacks';
import { listCorporateInquiries, updateCorporateInquiryStatus } from '../controllers/admin/corporateInquiries';
import { exportAdminData } from '../controllers/admin/export';
import { OTP_EXPIRY_MINS, isValidMobile, persistAndSendOtp } from '../services/otp';
import { BookingService } from '../services/booking.service';
import { validationSchemas } from '../utils/helpers';
import { sendInvoiceViaWhatsApp } from '../services/invoiceNotifications';
import { getInvoiceLinkExpiryHours } from '../services/invoiceAccess';
import { getReportLinkExpiryHours } from '../services/reportAccess';
import { sendSpecificReportViaWhatsApp } from '../services/reportNotifications';

const router = Router();
const healthians = HealthiansAdapter.getInstance();
const NON_RESCHEDULABLE_STATUSES = ['Cancelled', 'Sample Collected', 'Report Generated', 'Completed', 'Rescheduled'];
const MANAGER_GLOBAL_CANCELABLE_STATUSES = new Set(['CREATED', 'SENT', 'PAYMENT_RECEIVED', 'CONFIRMED']);
const INVOICE_ELIGIBLE_BOOKING_STATUSES = new Set(['Order Booked', 'Sample Collector Assigned', 'Sample Collected', 'Report Generated', 'Completed']);
const INVOICE_ELIGIBLE_PARTNER_STATUSES = new Set(['BS002', 'BS005', 'BS007', 'BS008', 'BS015']);
const managerCancelSchema = z.object({
    remarks: z.string().trim().min(5, 'Reason for cancellation must be at least 5 characters long'),
});

function canSendInvoiceForBooking(booking: {
    paymentStatus: string;
    status: string;
    partnerBookingId?: string | null;
    partnerStatus?: string | null;
    managerOrder?: { status: string } | null;
}) {
    if (booking.paymentStatus !== 'CONFIRMED') return false;
    if (!booking.partnerBookingId) return false;
    if (booking.managerOrder?.status === 'CONFIRMED') return true;
    if (booking.partnerStatus && INVOICE_ELIGIBLE_PARTNER_STATUSES.has(booking.partnerStatus)) return true;
    return INVOICE_ELIGIBLE_BOOKING_STATUSES.has(booking.status);
}

// All manager routes require auth + MANAGER/SUPER_ADMIN role
const mgr = [authMiddleware, requireManager] as const;

// Health check — verifies MANAGER/SUPER_ADMIN access for frontend auth guard
router.get('/health', ...mgr, async (req: AuthRequest, res: Response) => {
    res.json({ ok: true, manager: req.adminName || 'Manager', role: (req as any).user?.role });
});

// ============================================
// MANAGER DASHBOARD ADMIN ENDPOINTS
// ============================================

router.get('/callbacks', ...mgr, listCallbacks);
router.put('/callbacks/:id/status', ...mgr, updateCallbackStatus);
router.get('/corporate-inquiries', ...mgr, listCorporateInquiries);
router.put('/corporate-inquiries/:id/status', ...mgr, updateCorporateInquiryStatus);
router.get('/export', ...mgr, exportAdminData);

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

const managerUserCreateSchema = z.object({
    mobile: z.string().regex(/^\d{10}$/, 'Valid 10-digit mobile number is required'),
    name: z.string().trim().min(1, 'Name is required'),
    age: z.number().int().min(1, 'Age is required').max(150, 'Invalid age'),
    gender: z.enum(['Male', 'Female', 'Other'], { message: 'Gender must be Male, Female, or Other' }),
    email: z.string().email('Invalid email').optional().or(z.literal(''))
});

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

router.post('/users/create/send-otp', ...mgr, async (req: AuthRequest, res: Response) => {
    try {
        const parsed = managerUserCreateSchema.parse({
            ...req.body,
            age: Number(req.body?.age)
        });

        const { mobile, email } = parsed;
        if (!isValidMobile(mobile)) {
            return res.status(400).json({ error: 'Valid 10-digit mobile number is required' });
        }

        const [existingUser, existingEmail] = await Promise.all([
            prisma.user.findUnique({ where: { mobile } }),
            email ? prisma.user.findUnique({ where: { email } }) : Promise.resolve(null)
        ]);

        if (existingUser) {
            return res.status(409).json({ error: 'User with this mobile number already exists. Please search and select them.' });
        }

        if (existingEmail) {
            return res.status(409).json({ error: 'User with this email already exists.' });
        }

        await persistAndSendOtp(mobile, 'manager_create');
        res.status(200).json({ message: 'OTP sent successfully', expiry: OTP_EXPIRY_MINS });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.issues[0]?.message || 'Invalid user details' });
        }
        console.error('[Manager] Create user send OTP error:', error);
        res.status(500).json({ error: error.message || 'Failed to send OTP' });
    }
});

router.post('/users/create/verify', ...mgr, async (req: AuthRequest, res: Response) => {
    try {
        const { code } = req.body as { code?: string };
        if (!code) {
            return res.status(400).json({ error: 'OTP code is required' });
        }

        const parsed = managerUserCreateSchema.parse({
            ...req.body,
            age: Number(req.body?.age)
        });
        const { mobile, name, age, gender, email } = parsed;

        const otpRecord = await prisma.oTP.findUnique({ where: { identifier: mobile } });
        if (!otpRecord || new Date() > otpRecord.expiresAt || otpRecord.code !== code) {
            return res.status(400).json({ error: 'Invalid or expired OTP' });
        }

        const [existingUser, existingEmail] = await Promise.all([
            prisma.user.findUnique({ where: { mobile } }),
            email ? prisma.user.findUnique({ where: { email } }) : Promise.resolve(null)
        ]);

        if (existingUser) {
            return res.status(409).json({ error: 'User with this mobile number already exists. Please search and select them.' });
        }

        if (existingEmail) {
            return res.status(409).json({ error: 'User with this email already exists.' });
        }

        const ipAddress = getClientIP(req);
        const createdUser = await prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: {
                    mobile,
                    name,
                    age,
                    gender,
                    email: email || null,
                    isVerified: true,
                    role: 'USER',
                    status: 'ACTIVE',
                    referralCode: generateReferralCode(name)
                }
            });

            await tx.wallet.create({ data: { userId: user.id } });
            await tx.oTP.delete({ where: { identifier: mobile } });
            await tx.adminAuditLog.create({
                data: {
                    adminId: req.adminId!,
                    adminName: req.adminName || 'Manager',
                    action: 'USER_CREATED_BY_MANAGER',
                    entity: 'User',
                    targetId: user.id,
                    newValue: {
                        name: user.name,
                        mobile: user.mobile,
                        email: user.email,
                        role: user.role
                    },
                    ipAddress,
                    isDestructive: false
                }
            });

            return user;
        });

        res.status(201).json({
            message: 'User created successfully',
            user: {
                id: createdUser.id,
                name: createdUser.name,
                mobile: createdUser.mobile,
                email: createdUser.email
            }
        });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.issues[0]?.message || 'Invalid user details' });
        }
        console.error('[Manager] Create user verify error:', error);
        res.status(500).json({ error: error.message || 'Failed to create user' });
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

// ============================================
// C. Address CRUD (for a customer, performed by manager)
// ============================================

const addressSchema = z.object({
    line1:   z.string().min(3),
    city:    z.string().min(1),
    pincode: z.string().regex(/^\d{6}$/, 'Pincode must be 6 digits'),
    lat:     z.string().optional(),
    long:    z.string().optional(),
});

// List (exclude soft-deleted)
router.get('/users/:userId/addresses', ...mgr, async (req: AuthRequest, res: Response) => {
    const userId = req.params.userId as string;
    try {
        const addresses = await prisma.address.findMany({
            where: { userId, isDeleted: false }
        });
        res.json(addresses);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Create
router.post('/users/:userId/addresses', ...mgr, async (req: AuthRequest, res: Response) => {
    const userId = req.params.userId as string;
    try {
        const validated = addressSchema.parse(req.body);
        const address = await prisma.address.create({
            data: { ...validated, userId }
        });
        res.status(201).json(address);
    } catch (error: any) {
        res.status(400).json({ error: error.errors || error.message });
    }
});

// Update
router.put('/users/:userId/addresses/:id', ...mgr, async (req: AuthRequest, res: Response) => {
    const userId = req.params.userId as string;
    const id = req.params.id as string;
    try {
        const validated = addressSchema.partial().parse(req.body);
        const address = await prisma.address.update({
            where: { id, userId },
            data: validated
        });
        res.json(address);
    } catch (error: any) {
        res.status(400).json({ error: error.errors || error.message });
    }
});

// Soft delete
router.delete('/users/:userId/addresses/:id', ...mgr, async (req: AuthRequest, res: Response) => {
    const userId = req.params.userId as string;
    const id = req.params.id as string;
    try {
        await prisma.address.update({
            where: { id, userId },
            data: { isDeleted: true }
        });
        res.json({ message: 'Address deleted' });
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});


// D. Slot Fetch
router.post('/slots', ...mgr, async (req: AuthRequest, res: Response) => {
    const { lat, long, zipcode, date, items } = req.body;
    try {
        if (!zipcode || !date || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'zipcode, date, and items are required' });
        }

        let finalLat = typeof lat === 'string' ? lat : '';
        let finalLong = typeof long === 'string' ? long : '';

        if (!finalLat || !finalLong || finalLat === '0' || finalLong === '0') {
            const geodata = await getGeodataFromPincode(String(zipcode));
            if (geodata) {
                finalLat = geodata.lat;
                finalLong = geodata.long;
            }
        }

        if (!finalLat || !finalLong || finalLat === '0' || finalLong === '0') {
            return res.status(400).json({ error: 'Address is missing valid coordinates. Please update the address with latitude and longitude or try a different pincode.' });
        }

        const serviceability = await healthians.checkServiceability(finalLat, finalLong, String(zipcode));
        const zoneId = serviceability?.data?.zone_id;
        if (!zoneId) {
            return res.status(400).json({ error: 'Could not determine zone for the selected address' });
        }

        const testCodes = items
            .map((i: any) => i?.testCode)
            .filter((code: unknown): code is string => typeof code === 'string' && code.length > 0);

        if (testCodes.length === 0) {
            return res.status(400).json({ error: 'No valid test codes found for slot lookup' });
        }

        const catalogItems = await prisma.catalogItem.findMany({
            where: { partnerCode: { in: testCodes } }
        });
        const catalogMap = new Map(catalogItems.map(item => [item.partnerCode, item]));
        const amount = testCodes.reduce((sum, code) => {
            const item = catalogMap.get(code);
            return sum + Math.max(0, item?.discountedPrice ?? item?.displayPrice ?? 0);
        }, 0);

        const response = await healthians.getSlotsByLocation({
            lat: finalLat,
            long: finalLong,
            zipcode: String(zipcode),
            zone_id: String(zoneId),
            slot_date: String(date),
            amount,
            package: [{ deal_id: testCodes }],
            get_ppmc_slots: 0,
            has_female_patient: 0
        });
        const results = Array.isArray(response) ? response : (response.data || response.slots || response || []);
        res.json(results);
    } catch (error: any) {
        console.error('[Manager] Slot fetch error:', error);
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
router.post('/orders/:id/cancel', ...mgr, async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const parsed = managerCancelSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Reason is required' });
    }

    try {
        const result = await cancelManagerOrder({
            managerOrderId: id,
            managerId: req.userId!,
            adminId: req.adminId!,
            adminName: req.adminName || 'Manager',
            ipAddress: getClientIP(req),
            remarks: parsed.data.remarks,
        });
        res.json(result);
    } catch (error: any) {
        console.error('[Manager] Cancel order error:', error);

        const message = error.message || 'Failed to cancel order';
        if (message.includes('not found') || message.includes('access denied')) {
            return res.status(404).json({ error: message });
        }
        if (
            message.includes('already cancelled') ||
            message.includes('Cancellation not allowed') ||
            message.includes('cannot be cancelled') ||
            message.includes('Partner Booking ID is missing') ||
            message.includes('No active customers found')
        ) {
            return res.status(400).json({ error: message, details: error.details });
        }

        res.status(500).json({ error: message, details: error.details });
    }
});

router.get('/bookings', ...mgr, async (req: AuthRequest, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const search = (req.query.search as string) || '';
        const status = req.query.status as string;
        const dateFrom = req.query.dateFrom as string;
        const dateTo = req.query.dateTo as string;

        const where: any = {};

        if (status && status !== 'All') {
            where.status = status;
        }

        if (dateFrom || dateTo) {
            where.createdAt = {};
            if (dateFrom) {
                where.createdAt.gte = new Date(`${dateFrom}T00:00:00.000Z`);
            }
            if (dateTo) {
                const end = new Date(`${dateTo}T00:00:00.000Z`);
                end.setUTCDate(end.getUTCDate() + 1);
                where.createdAt.lt = end;
            }
        }

        if (search) {
            where.OR = [
                { id: { contains: search, mode: 'insensitive' } },
                { partnerBookingId: { contains: search, mode: 'insensitive' } },
                { user: { name: { contains: search, mode: 'insensitive' } } },
                { user: { mobile: { contains: search } } },
                { items: { some: { patient: { name: { contains: search, mode: 'insensitive' } } } } },
                { items: { some: { testName: { contains: search, mode: 'insensitive' } } } },
            ];
        }

        const [orders, total] = await Promise.all([
            prisma.booking.findMany({
                where,
                skip: (page - 1) * limit,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    user: { select: { id: true, name: true, mobile: true, email: true } },
                    address: { select: { id: true, line1: true, city: true, pincode: true } },
                    managerOrder: { select: { id: true, status: true, managerId: true } },
                    items: {
                        include: {
                            patient: { select: { name: true, relation: true, gender: true, age: true } }
                        }
                    },
                    reports: {
                        select: {
                            id: true,
                            fetchStatus: true,
                            generatedAt: true,
                        },
                        orderBy: { generatedAt: 'desc' },
                        take: 1,
                    },
                    _count: {
                        select: {
                            reports: true,
                        }
                    }
                }
            }),
            prisma.booking.count({ where }),
        ]);

        const orderIds = orders.map((order) => order.id);
        const invoiceAuditLogs = orderIds.length > 0
            ? await prisma.adminAuditLog.findMany({
                where: {
                    action: 'MANAGER_INVOICE_SENT',
                    entity: 'Booking',
                    targetId: { in: orderIds },
                },
                orderBy: { createdAt: 'desc' },
            })
            : [];
        const invoiceAuditByBookingId = new Map<string, Date>();
        invoiceAuditLogs.forEach((log) => {
            if (log.targetId && !invoiceAuditByBookingId.has(log.targetId)) {
                invoiceAuditByBookingId.set(log.targetId, log.createdAt);
            }
        });
        const reportAuditLogs = orderIds.length > 0
            ? await prisma.adminAuditLog.findMany({
                where: {
                    action: 'MANAGER_REPORT_SENT',
                    entity: 'Booking',
                    targetId: { in: orderIds },
                },
                orderBy: { createdAt: 'desc' },
            })
            : [];
        const reportAuditByBookingId = new Map<string, Date>();
        reportAuditLogs.forEach((log) => {
            if (log.targetId && !reportAuditByBookingId.has(log.targetId)) {
                reportAuditByBookingId.set(log.targetId, log.createdAt);
            }
        });

        res.json({
            orders: orders.map((order) => {
                const latestReport = order.reports[0] || null;
                const canCancel = order.managerOrder
                    ? MANAGER_GLOBAL_CANCELABLE_STATUSES.has(order.managerOrder.status)
                    : order.status !== 'Cancelled' && order.paymentStatus !== 'CANCELLED' && order.paymentStatus !== 'REFUNDED';
                const canReschedule = Boolean(order.partnerBookingId) && !NON_RESCHEDULABLE_STATUSES.includes(order.status);
                const canSendInvoice = canSendInvoiceForBooking(order);
                const invoiceSentAt = invoiceAuditByBookingId.get(order.id) || null;
                const canSendReport = Boolean(latestReport?.id);
                const reportSentAt = reportAuditByBookingId.get(order.id) || null;

                return {
                    id: order.id,
                    partnerBookingId: order.partnerBookingId,
                    date: order.createdAt,
                    createdAt: order.createdAt,
                    slotDate: order.slotDate,
                    slotTime: order.slotTime,
                    amount: order.totalAmount,
                    status: order.status,
                    paymentStatus: order.paymentStatus,
                    user: order.user,
                    address: order.address,
                    managerOrder: order.managerOrder,
                    patient: order.items[0]?.patient || null,
                    testNames: order.items.map((item) => item.testName),
                    reportCount: order._count.reports,
                    latestReportId: latestReport?.id || null,
                    latestReportStatus: latestReport?.fetchStatus || null,
                    canCancel,
                    canReschedule,
                    canSendInvoice,
                    invoiceSentAt,
                    canSendReport,
                    reportSentAt,
                };
            }),
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    } catch (error) {
        console.error('[Manager] Error fetching global bookings:', error);
        res.status(500).json({ error: 'Failed to fetch bookings' });
    }
});

router.get('/bookings/:id/reports', ...mgr, async (req: AuthRequest, res: Response) => {
    try {
        const bookingId = req.params.id as string;

        const booking = await prisma.booking.findUnique({
            where: { id: bookingId },
            select: { id: true },
        });

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        const reports = await prisma.report.findMany({
            where: { bookingId },
            select: {
                id: true,
                isFullReport: true,
                fetchStatus: true,
                verifiedAt: true,
                fileSize: true,
                generatedAt: true,
                vendorCustomerId: true,
            },
            orderBy: { generatedAt: 'desc' },
        });

        res.json({ reports });
    } catch (error) {
        console.error('[Manager] Error fetching booking reports:', error);
        res.status(500).json({ error: 'Failed to fetch reports' });
    }
});

router.post('/bookings/:id/send-invoice', ...mgr, async (req: AuthRequest, res: Response) => {
    try {
        const bookingId = req.params.id as string;

        const booking = await prisma.booking.findUnique({
            where: { id: bookingId },
            include: {
                user: {
                    select: { id: true, name: true, mobile: true }
                },
                managerOrder: {
                    select: { status: true }
                }
            }
        });

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        if (!canSendInvoiceForBooking(booking)) {
            return res.status(400).json({ error: 'Invoice can be sent only after payment is confirmed and the booking is successfully placed.' });
        }

        const invoiceLabel = booking.partnerBookingId || booking.id.slice(0, 8).toUpperCase();
        const delivery = await sendInvoiceViaWhatsApp({
            bookingId: booking.id,
            mobile: booking.user.mobile,
            customerName: booking.user.name,
            invoiceLabel,
        });

        await prisma.adminAuditLog.create({
            data: {
                adminId: req.adminId!,
                adminName: req.adminName || 'Manager',
                action: 'MANAGER_INVOICE_SENT',
                entity: 'Booking',
                targetId: booking.id,
                newValue: {
                    mobile: booking.user.mobile,
                    invoiceLabel,
                    providerMessageId: delivery.id,
                    providerStatus: delivery.status,
                    invoiceLink: delivery.invoiceLink,
                    linkExpiryHours: getInvoiceLinkExpiryHours(),
                },
                ipAddress: getClientIP(req),
                isDestructive: false,
            }
        });

        res.json({
            success: true,
            message: 'Invoice sent successfully',
            mobile: booking.user.mobile,
            sentAt: new Date().toISOString(),
        });
    } catch (error: any) {
        console.error('[Manager] Send invoice error:', error);
        res.status(500).json({ error: error.message || 'Failed to send invoice' });
    }
});

router.post('/bookings/:id/send-report', ...mgr, async (req: AuthRequest, res: Response) => {
    try {
        const bookingId = req.params.id as string;

        const booking = await prisma.booking.findUnique({
            where: { id: bookingId },
            include: {
                user: {
                    select: { id: true, name: true, mobile: true }
                },
                items: {
                    select: { testName: true }
                },
                reports: {
                    where: {
                        OR: [
                            { fetchStatus: 'STORED' },
                            { storageKey: { not: null } },
                            { sourceUrl: { not: '' } },
                        ],
                    },
                    orderBy: { generatedAt: 'desc' },
                    take: 1,
                }
            }
        });

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        const bookingData = booking as typeof booking & {
            reports: Array<{ id: string }>;
            items: Array<{ testName: string }>;
            user: { mobile: string; name: string | null };
        };

        const report = bookingData.reports[0];
        if (!report) {
            return res.status(400).json({ error: 'No downloadable report is available for this booking yet.' });
        }

        const itemNames = bookingData.items.map((item) => item.testName).filter(Boolean);
        const reportLabel =
            itemNames.length === 0
                ? `Booking ${bookingData.id.slice(0, 8)} report`
                : itemNames.length === 1
                    ? itemNames[0]
                    : `${itemNames[0]} + ${itemNames.length - 1} more test${itemNames.length - 1 > 1 ? 's' : ''}`;

        const delivery = await sendSpecificReportViaWhatsApp({
            mobile: bookingData.user.mobile,
            customerName: bookingData.user.name,
            reportLabel,
            reportId: report.id,
        });

        await prisma.adminAuditLog.create({
            data: {
                adminId: req.adminId!,
                adminName: req.adminName || 'Manager',
                action: 'MANAGER_REPORT_SENT',
                entity: 'Booking',
                targetId: bookingData.id,
                newValue: {
                    mobile: bookingData.user.mobile,
                    reportId: report.id,
                    reportLabel,
                    providerMessageId: delivery.id,
                    providerStatus: delivery.status,
                    reportLink: delivery.reportLink,
                    linkExpiryHours: getReportLinkExpiryHours(),
                },
                ipAddress: getClientIP(req),
                isDestructive: false,
            }
        });

        res.json({
            success: true,
            message: 'Report sent successfully',
            mobile: bookingData.user.mobile,
            sentAt: new Date().toISOString(),
        });
    } catch (error: any) {
        console.error('[Manager] Send report error:', error);
        res.status(500).json({ error: error.message || 'Failed to send report' });
    }
});

router.get('/bookings/:id/reschedulable-slots', ...mgr, async (req: AuthRequest, res: Response) => {
    try {
        const bookingId = req.params.id as string;
        const date = req.query.date as string || new Date().toISOString().split('T')[0];
        const selectedAddressId = (req.query.addressId as string) || null;

        const booking = await prisma.booking.findUnique({
            where: { id: bookingId },
            include: { items: true, address: true, user: { select: { id: true } } }
        });

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        const fallbackAddress = !booking.address && selectedAddressId
            ? await prisma.address.findFirst({
                where: {
                    id: selectedAddressId,
                    userId: booking.userId,
                }
            })
            : null;
        const address = booking.address ?? fallbackAddress;

        if (!address) {
            const addresses = await prisma.address.findMany({
                where: { userId: booking.userId },
                select: { id: true, line1: true, city: true, pincode: true },
                orderBy: { id: 'desc' },
            });

            return res.status(400).json({
                error: 'Booking address is missing. Please select an address to continue.',
                code: 'ADDRESS_REQUIRED',
                addresses,
            });
        }

        const zoneId = await BookingService.getZoneId(
            address.lat || '28.6139',
            address.long || '77.2090',
            address.pincode
        );

        if (!zoneId) {
            return res.status(400).json({ error: 'Could not determine zone_id for rescheduling' });
        }

        const patientGroups = new Map<string, string[]>();
        booking.items.forEach((item: any) => {
            if (!patientGroups.has(item.patientId)) {
                patientGroups.set(item.patientId, []);
            }
            patientGroups.get(item.patientId)!.push(item.testCode);
        });

        const packagesPayload = Array.from(patientGroups.values()).map((testCodes) => ({
            deal_id: testCodes
        }));

        const slotsResponse = await healthians.getSlotsByLocation({
            lat: address.lat || '28.6139',
            long: address.long || '77.2090',
            zipcode: address.pincode,
            zone_id: zoneId.toString(),
            slot_date: date,
            amount: booking.totalAmount,
            package: packagesPayload
        });

        res.json(slotsResponse);
    } catch (error) {
        console.error('[Manager] Fetch reschedulable slots error:', error);
        res.status(500).json({ error: 'Failed to fetch available slots for rescheduling' });
    }
});

router.post('/bookings/:id/reschedule', ...mgr, async (req: AuthRequest, res: Response) => {
    try {
        const bookingId = req.params.id as string;
        const { slot_id, slotDate, slotTime, reschedule_reason, addressId } = req.body;

        const parse = validationSchemas.rescheduleBooking.safeParse({ slot_id, slotDate, slotTime, reschedule_reason });
        if (!parse.success) {
            return res.status(400).json({ error: parse.error.issues[0].message });
        }

        const booking = await prisma.booking.findUnique({
            where: { id: bookingId },
            include: { items: true, address: true }
        });

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        if (NON_RESCHEDULABLE_STATUSES.includes(booking.status)) {
            return res.status(400).json({ error: `Booking cannot be rescheduled in current status: ${booking.status}` });
        }

        if (!booking.partnerBookingId) {
            return res.status(400).json({ error: 'Partner booking ID not found' });
        }

        const fallbackAddress = !booking.address && addressId
            ? await prisma.address.findFirst({
                where: { id: addressId, userId: booking.userId }
            })
            : null;
        const address = booking.address ?? fallbackAddress;

        if (!address) {
            return res.status(400).json({ error: 'Booking address is missing. Please select an address first.' });
        }

        const { customers } = await BookingService.getHealthiansCustomers(booking.partnerBookingId);
        if (customers.length === 0) {
            return res.status(400).json({ error: 'No customers found for this booking' });
        }

        const response = await healthians.rescheduleBooking({
            booking_id: booking.partnerBookingId,
            slot: { slot_id: String(slot_id) },
            customers: customers.map((customer: any) => ({
                vendor_customer_id: String(customer.vendor_customer_id)
            })),
            reschedule_reason,
        });

        if (!(response.status && response.data?.new_booking_id)) {
            return res.status(400).json({ error: response.message || 'Failed to reschedule on partner platform' });
        }

        const newPartnerBookingId = response.data.new_booking_id;

        const result = await prisma.$transaction(async (tx) => {
            const newBooking = await tx.booking.create({
                data: {
                    userId: booking.userId,
                    addressId: address.id,
                    addressLine: booking.addressLine || address.line1,
                    addressCity: booking.addressCity || address.city,
                    addressPincode: booking.addressPincode || address.pincode,
                    addressLat: booking.addressLat || address.lat,
                    addressLong: booking.addressLong || address.long,
                    partnerBookingId: newPartnerBookingId.toString(),
                    status: 'Order Booked',
                    slotDate,
                    slotTime,
                    totalAmount: booking.totalAmount,
                    paymentStatus: booking.paymentStatus,
                    razorpayOrderId: booking.razorpayOrderId,
                    razorpayPaymentId: booking.razorpayPaymentId,
                    paidAt: booking.paidAt,
                    items: {
                        create: booking.items.map((item) => ({
                            testCode: item.testCode,
                            testName: item.testName,
                            price: item.price,
                            patientId: item.patientId
                        }))
                    }
                }
            });

            await tx.booking.update({
                where: { id: bookingId },
                data: { status: 'Rescheduled', rescheduledToId: newBooking.id }
            });

            await tx.adminAuditLog.create({
                data: {
                    adminId: req.adminId!,
                    adminName: req.adminName || 'Manager',
                    action: 'MANAGER_BOOKING_RESCHEDULED',
                    entity: 'Booking',
                    targetId: bookingId,
                    oldValue: {
                        slotDate: booking.slotDate,
                        slotTime: booking.slotTime,
                        partnerBookingId: booking.partnerBookingId,
                    },
                    newValue: {
                        slotDate,
                        slotTime,
                        partnerBookingId: String(newPartnerBookingId),
                        newBookingId: newBooking.id,
                        reason: reschedule_reason,
                    },
                    ipAddress: getClientIP(req),
                    isDestructive: false,
                }
            });

            return newBooking;
        });

        res.json({
            success: true,
            message: 'Booking rescheduled successfully',
            new_booking_id: result.id
        });
    } catch (error: any) {
        console.error('[Manager] Reschedule error:', error);
        res.status(500).json({
            error: error.response?.data?.message || error.message || 'Internal server error while rescheduling',
            details: error.response?.data,
        });
    }
});

router.post('/bookings/:id/cancel', ...mgr, async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const parsed = managerCancelSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Reason is required' });
    }

    try {
        const result = await cancelGlobalBookingAsManager({
            bookingId: id,
            managerId: req.userId!,
            adminId: req.adminId!,
            adminName: req.adminName || 'Manager',
            ipAddress: getClientIP(req),
            remarks: parsed.data.remarks,
        });
        res.json(result);
    } catch (error: any) {
        console.error('[Manager] Cancel booking error:', error);

        const message = error.message || 'Failed to cancel booking';
        if (message.includes('not found')) {
            return res.status(404).json({ error: message });
        }
        if (
            message.includes('already cancelled') ||
            message.includes('Cancellation not allowed') ||
            message.includes('cannot be cancelled') ||
            message.includes('Partner Booking ID is missing') ||
            message.includes('No active customers found')
        ) {
            return res.status(400).json({ error: message, details: error.details });
        }

        res.status(500).json({ error: message, details: error.details });
    }
});

router.get('/orders', ...mgr, async (req: AuthRequest, res: Response) => {
    const { status, page = '1', limit = '50' } = req.query;
    try {
        const orders = await prisma.managerOrder.findMany({
            where: {
                managerId: req.userId,
                ...(status ? { status: status as any } : {})
            },
            include: {
                booking: {
                    select: {
                        status: true,
                        paymentStatus: true,
                        partnerBookingId: true,
                        partnerStatus: true,
                        reports: {
                            where: {
                                OR: [
                                    { fetchStatus: 'STORED' },
                                    { storageKey: { not: null } },
                                    { sourceUrl: { not: '' } },
                                ],
                            },
                            orderBy: { generatedAt: 'desc' },
                            take: 1,
                            select: { id: true }
                        },
                        items: {
                            select: { testName: true }
                        }
                    }
                },
                customer: { select: { name: true, mobile: true } }
            },
            orderBy: { createdAt: 'desc' },
            skip: (parseInt(page as string) - 1) * parseInt(limit as string),
            take: parseInt(limit as string)
        });
        const bookingIds = orders.map((order) => order.bookingId);
        const invoiceAuditLogs = bookingIds.length > 0
            ? await prisma.adminAuditLog.findMany({
                where: {
                    action: 'MANAGER_INVOICE_SENT',
                    entity: 'Booking',
                    targetId: { in: bookingIds },
                },
                orderBy: { createdAt: 'desc' },
            })
            : [];
        const invoiceAuditByBookingId = new Map<string, string>();
        invoiceAuditLogs.forEach((log) => {
            if (log.targetId && !invoiceAuditByBookingId.has(log.targetId)) {
                invoiceAuditByBookingId.set(log.targetId, log.createdAt.toISOString());
            }
        });
        const reportAuditLogs = bookingIds.length > 0
            ? await prisma.adminAuditLog.findMany({
                where: {
                    action: 'MANAGER_REPORT_SENT',
                    entity: 'Booking',
                    targetId: { in: bookingIds },
                },
                orderBy: { createdAt: 'desc' },
            })
            : [];
        const reportAuditByBookingId = new Map<string, string>();
        reportAuditLogs.forEach((log) => {
            if (log.targetId && !reportAuditByBookingId.has(log.targetId)) {
                reportAuditByBookingId.set(log.targetId, log.createdAt.toISOString());
            }
        });

        const managerOrders = orders as Array<typeof orders[number] & {
            booking: {
                paymentStatus: string;
                status: string;
                partnerBookingId: string | null;
                partnerStatus: string | null;
                reports: Array<{ id: string }>;
            };
        }>;

        res.json(managerOrders.map((order) => ({
            ...order,
            canSendInvoice: canSendInvoiceForBooking({
                paymentStatus: order.booking.paymentStatus,
                status: order.booking.status,
                partnerBookingId: order.booking.partnerBookingId,
                partnerStatus: order.booking.partnerStatus,
                managerOrder: { status: order.status },
            }),
            invoiceSentAt: invoiceAuditByBookingId.get(order.bookingId) || null,
            canSendReport: Boolean(order.booking.reports[0]?.id),
            reportSentAt: reportAuditByBookingId.get(order.bookingId) || null,
        })));
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
