"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const healthians_1 = require("../adapters/healthians");
const auth_1 = require("../middleware/auth");
const db_1 = require("../db");
const router = (0, express_1.Router)();
const healthians = healthians_1.HealthiansAdapter.getInstance();
// GET /api/slots?lat=...&long=...&zipcode=...&cartId=...
router.get('/', auth_1.authMiddleware, async (req, res) => {
    const { lat, long, zipcode } = req.query;
    if (!lat || !long || !zipcode) {
        return res.status(400).json({ error: 'Missing lat, long, or zipcode' });
    }
    try {
        // Step 1: Check serviceability to get zone_id
        const serviceabilityData = await healthians.checkServiceability(lat, long, zipcode);
        console.log('Serviceability Data:', JSON.stringify(serviceabilityData, null, 2));
        if (!serviceabilityData || !serviceabilityData.data || !serviceabilityData.data.zone_id) {
            return res.status(400).json({
                error: 'Location not serviceable or zone_id not available',
                data: serviceabilityData
            });
        }
        const zoneId = serviceabilityData.data.zone_id;
        console.log('Zone ID:', zoneId);
        // Step 2: Get user's cart to calculate amount and build package array
        const cart = await db_1.prisma.cart.findUnique({
            where: { userId: req.userId },
            include: {
                items: {
                    include: {
                        patient: true
                    }
                }
            }
        });
        if (!cart || cart.items.length === 0) {
            return res.status(400).json({ error: 'Cart is empty' });
        }
        // Calculate total amount
        const totalAmount = cart.items.reduce((sum, item) => sum + item.price, 0);
        // Build package array - group by patient
        // Each patient gets their own package object with their test deal_ids
        const packagesByPatient = new Map();
        cart.items.forEach(item => {
            const patientKey = item.patientId || 'self';
            if (!packagesByPatient.has(patientKey)) {
                packagesByPatient.set(patientKey, []);
            }
            // Format: test_<testCode> or package_<testCode>
            // We'll use the testCode from cart as-is since it should already be in correct format
            packagesByPatient.get(patientKey).push(item.testCode);
        });
        const packageArray = Array.from(packagesByPatient.values()).map(dealIds => ({
            deal_id: dealIds
        }));
        // Step 3: Get slots for date (default to today)
        const today = new Date();
        const maxDate = new Date();
        maxDate.setDate(today.getDate() + 6); // Today + 6 days constraint
        let slotDate = today.toISOString().split('T')[0]; // Default to today
        // If 'date' query param is provided, use it
        if (req.query.date) {
            const requestedDate = new Date(req.query.date);
            // Validate date is valid and within range
            if (isNaN(requestedDate.getTime())) {
                return res.status(400).json({ error: 'Invalid date format' });
            }
            // Reset times for accurate comparison
            const todayReset = new Date(today.setHours(0, 0, 0, 0));
            const requestedReset = new Date(requestedDate.setHours(0, 0, 0, 0));
            const maxReset = new Date(maxDate.setHours(0, 0, 0, 0));
            if (requestedReset < todayReset || requestedReset > maxReset) {
                return res.status(400).json({
                    error: 'Date must be between today and today + 6 days'
                });
            }
            slotDate = req.query.date;
        }
        console.log('Slot Request Params:', {
            lat,
            long,
            zipcode,
            zone_id: zoneId,
            slot_date: slotDate,
            amount: totalAmount,
            package: packageArray
        });
        const slotsData = await healthians.getSlotsByLocation({
            lat: lat,
            long: long,
            zipcode: zipcode,
            zone_id: zoneId,
            slot_date: slotDate,
            amount: totalAmount,
            package: packageArray,
            get_ppmc_slots: 0,
            has_female_patient: 0
        });
        console.log('Slots API Response:', JSON.stringify(slotsData, null, 2));
        res.json(slotsData);
    }
    catch (error) {
        console.error('Error fetching slots:', error);
        res.status(500).json({ error: 'Failed to fetch slots' });
    }
});
// POST /api/slots/freeze
router.post('/freeze', auth_1.authMiddleware, async (req, res) => {
    const { slot_id } = req.body;
    if (!slot_id) {
        return res.status(400).json({ error: 'Missing required slot_id' });
    }
    try {
        // Use the authenticated user's ID as the vendor_billing_user_id
        const vendorBillingUserId = req.userId || 'guest';
        const data = await healthians.freezeSlot(slot_id, vendorBillingUserId);
        res.json(data);
    }
    catch (error) {
        console.error('Error freezing slot:', error);
        res.status(500).json({ error: 'Failed to freeze slot' });
    }
});
exports.default = router;
