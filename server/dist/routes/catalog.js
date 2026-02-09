"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const healthians_1 = require("../adapters/healthians");
const router = (0, express_1.Router)();
const healthians = healthians_1.HealthiansAdapter.getInstance();
// GET /api/catalog/products?zipcode=...
router.get('/products', async (req, res) => {
    const { zipcode } = req.query;
    if (!zipcode) {
        return res.status(400).json({ error: 'Missing zipcode' });
    }
    try {
        const data = await healthians.getPartnerProducts(zipcode);
        res.json(data);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});
exports.default = router;
