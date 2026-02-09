"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const geocoding_1 = require("../utils/geocoding");
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
// GET /api/profile/addresses - Get all addresses
router.get('/', auth_1.authMiddleware, async (req, res) => {
    try {
        const addresses = await prisma.address.findMany({
            where: { userId: req.userId },
            orderBy: { city: 'asc' }
        });
        res.status(200).json(addresses);
    }
    catch (error) {
        console.error('Get Addresses Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// POST /api/profile/addresses - Add new address
router.post('/', auth_1.authMiddleware, async (req, res) => {
    try {
        const { line1, city, pincode, lat, long } = req.body;
        // Validate required fields
        if (!line1 || !city || !pincode) {
            res.status(400).json({ error: 'line1, city, and pincode are required' });
            return;
        }
        // Validate pincode format (6 digits for India)
        if (!/^\d{6}$/.test(pincode)) {
            res.status(400).json({ error: 'Invalid pincode format' });
            return;
        }
        // Automatically geocode if lat/long are missing
        let finalLat = lat;
        let finalLong = long;
        let detectedCity = city;
        if (!finalLat || !finalLong) {
            const geodata = await (0, geocoding_1.getGeodataFromPincode)(pincode);
            if (geodata) {
                finalLat = geodata.lat;
                finalLong = geodata.long;
                if (!detectedCity)
                    detectedCity = geodata.city;
            }
        }
        const address = await prisma.address.create({
            data: {
                userId: req.userId,
                line1,
                city: detectedCity,
                pincode,
                lat: finalLat || null,
                long: finalLong || null
            }
        });
        res.status(201).json({
            message: 'Address added successfully',
            address
        });
    }
    catch (error) {
        console.error('Create Address Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// PUT /api/profile/addresses/:id - Update address
router.put('/:id', auth_1.authMiddleware, async (req, res) => {
    try {
        const id = req.params.id;
        const { line1, city, pincode, lat, long } = req.body;
        // Check ownership
        const address = await prisma.address.findUnique({
            where: { id }
        });
        if (!address) {
            res.status(404).json({ error: 'Address not found' });
            return;
        }
        if (address.userId !== req.userId) {
            res.status(403).json({ error: 'Unauthorized' });
            return;
        }
        // Build update data
        const updateData = {};
        if (line1)
            updateData.line1 = line1;
        if (city)
            updateData.city = city;
        if (pincode) {
            if (!/^\d{6}$/.test(pincode)) {
                res.status(400).json({ error: 'Invalid pincode format' });
                return;
            }
            updateData.pincode = pincode;
            // If pincode changed and no new coordinates provided, refresh them
            if (pincode !== address.pincode && (!lat || !long)) {
                const geodata = await (0, geocoding_1.getGeodataFromPincode)(pincode);
                if (geodata) {
                    updateData.lat = geodata.lat;
                    updateData.long = geodata.long;
                    if (!city)
                        updateData.city = geodata.city;
                }
            }
        }
        if (lat !== undefined)
            updateData.lat = lat;
        if (long !== undefined)
            updateData.long = long;
        const updatedAddress = await prisma.address.update({
            where: { id },
            data: updateData
        });
        res.status(200).json({
            message: 'Address updated successfully',
            address: updatedAddress
        });
    }
    catch (error) {
        console.error('Update Address Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// DELETE /api/profile/addresses/:id - Remove address
router.delete('/:id', auth_1.authMiddleware, async (req, res) => {
    try {
        const id = req.params.id;
        // Check ownership
        const address = await prisma.address.findUnique({
            where: { id }
        });
        if (!address) {
            res.status(404).json({ error: 'Address not found' });
            return;
        }
        if (address.userId !== req.userId) {
            res.status(403).json({ error: 'Unauthorized' });
            return;
        }
        await prisma.address.delete({
            where: { id }
        });
        res.status(200).json({ message: 'Address removed successfully' });
    }
    catch (error) {
        console.error('Delete Address Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
exports.default = router;
