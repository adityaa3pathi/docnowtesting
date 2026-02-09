import { Router } from 'express';
import { HealthiansAdapter } from '../adapters/healthians';

const router = Router();
const healthians = HealthiansAdapter.getInstance();

// GET /api/catalog/products?zipcode=...
router.get('/products', async (req, res) => {
    const { zipcode } = req.query;

    if (!zipcode) {
        return res.status(400).json({ error: 'Missing zipcode' });
    }

    try {
        const data = await healthians.getPartnerProducts(zipcode as string);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

export default router;
