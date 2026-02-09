import { Router } from 'express';
import { HealthiansAdapter } from '../adapters/healthians';
import { getGeodataFromPincode } from '../utils/geocoding';

const router = Router();
const healthians = HealthiansAdapter.getInstance();

// GET /api/location/serviceability?lat=...&long=...&zipcode=...
router.get('/serviceability', async (req, res) => {
    const { lat, long, zipcode } = req.query;

    if (!lat || !long || !zipcode) {
        return res.status(400).json({ error: 'Missing lat, long, or zipcode' });
    }

    try {
        const data = await healthians.checkServiceability(
            lat as string,
            long as string,
            zipcode as string
        );
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to check serviceability' });
    }
});

// GET /api/location/active-zipcodes
router.get('/active-zipcodes', async (req, res) => {
    try {
        const data = await healthians.getActiveZipcodes();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch active zipcodes' });
    }
});

// GET /api/location/geocode?pincode=...
router.get('/geocode', async (req, res) => {
    const { pincode } = req.query;

    if (!pincode || typeof pincode !== 'string') {
        return res.status(400).json({ error: 'Missing Pincode' });
    }

    try {
        const geodata = await getGeodataFromPincode(pincode);
        if (geodata) {
            res.json(geodata);
        } else {
            res.status(404).json({ error: 'Location not found for this pincode' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Geocoding failed' });
    }
});

export default router;
