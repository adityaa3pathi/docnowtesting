import express, { Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getGeodataFromPincode } from '../utils/geocoding';
import { prisma } from '../db';

const router = express.Router();

// GET /api/profile/addresses - Get all addresses
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const addresses = await prisma.address.findMany({
            where: { userId: req.userId, isDeleted: false },
            orderBy: { city: 'asc' }
        });

        res.status(200).json(addresses);
    } catch (error) {
        console.error('Get Addresses Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST /api/profile/addresses - Add new address
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
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
            const geodata = await getGeodataFromPincode(pincode);
            if (geodata) {
                finalLat = geodata.lat;
                finalLong = geodata.long;
                if (!detectedCity) detectedCity = geodata.city;
            }
        }

        const address = await prisma.address.create({
            data: {
                userId: req.userId!,
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
    } catch (error) {
        console.error('Create Address Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// PUT /api/profile/addresses/:id - Update address
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const id = req.params.id as string;
        const { line1, city, pincode, lat, long } = req.body;

        // Check ownership
        const existing = await prisma.address.findUnique({
            where: { id }
        });

        if (!existing || existing.isDeleted) {
            res.status(404).json({ error: 'Address not found' });
            return;
        }

        if (existing.userId !== req.userId) {
            res.status(403).json({ error: 'Unauthorized' });
            return;
        }

        // Resolve final field values (merge existing with incoming)
        const finalPincode = pincode || existing.pincode;
        if (pincode && !/^\d{6}$/.test(pincode)) {
            res.status(400).json({ error: 'Invalid pincode format' });
            return;
        }

        let finalLat = lat !== undefined ? lat : existing.lat;
        let finalLong = long !== undefined ? long : existing.long;
        let finalCity = city || existing.city;

        // If pincode changed and no new coordinates provided, refresh geocoding
        if (pincode && pincode !== existing.pincode && (!lat || !long)) {
            const geodata = await getGeodataFromPincode(pincode);
            if (geodata) {
                finalLat = geodata.lat;
                finalLong = geodata.long;
                if (!city) finalCity = geodata.city;
            }
        }

        // Append-only: soft-delete the old address and create a new one.
        // This preserves historical booking references to the old address row.
        const [, newAddress] = await prisma.$transaction([
            prisma.address.update({
                where: { id },
                data: { isDeleted: true }
            }),
            prisma.address.create({
                data: {
                    userId: req.userId!,
                    line1: line1 || existing.line1,
                    city: finalCity,
                    pincode: finalPincode,
                    lat: finalLat || null,
                    long: finalLong || null
                }
            })
        ]);

        res.status(200).json({
            message: 'Address updated successfully',
            address: newAddress
        });
    } catch (error) {
        console.error('Update Address Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// DELETE /api/profile/addresses/:id - Remove address
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const id = req.params.id as string;

        // Check ownership
        const address = await prisma.address.findUnique({
            where: { id }
        });

        if (!address || address.isDeleted) {
            res.status(404).json({ error: 'Address not found' });
            return;
        }

        if (address.userId !== req.userId) {
            res.status(403).json({ error: 'Unauthorized' });
            return;
        }

        // Guard: prevent deleting last active address
        const activeCount = await prisma.address.count({
            where: { userId: req.userId, isDeleted: false }
        });

        if (activeCount <= 1) {
            res.status(400).json({
                error: 'Cannot delete your only address. Please add another address first.',
                code: 'LAST_ADDRESS'
            });
            return;
        }

        // Soft-delete: mark as deleted instead of removing the row.
        // Historical bookings referencing this address remain intact.
        await prisma.address.update({
            where: { id },
            data: { isDeleted: true }
        });

        res.status(200).json({ message: 'Address removed successfully' });
    } catch (error) {
        console.error('Delete Address Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

export default router;
