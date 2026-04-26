import express, { Request, Response } from 'express';
import axios from 'axios';

const router = express.Router();

// A simple proxy route that forwards everything to Healthians
// It expects a special header 'x-proxy-secret' to prevent unauthorized abuse.
router.all('/*', async (req: Request, res: Response) => {
    try {
        const secret = req.headers['x-proxy-secret'];
        const expectedSecret = process.env.HEALTHIANS_PROXY_SECRET || 'docnow-dev-proxy-secret-123';
        
        if (secret !== expectedSecret) {
             res.status(401).json({ error: 'Unauthorized proxy request' });
             return;
        }

        const baseUrl = process.env.HEALTHIANS_BASE_URL || 'https://t25crm.healthians.co.in/api';
        // req.params[0] captures the wildcard match '/*'
        const targetUrl = `${baseUrl}/${req.params[0]}`;

        // Forward headers, but clean up host-specific ones
        const headers = { ...req.headers };
        delete headers['host'];
        delete headers['x-proxy-secret'];
        delete headers['content-length']; // let axios calculate new length

        const response = await axios({
            method: req.method,
            url: targetUrl,
            data: req.body,
            headers: headers as any,
            // Don't throw on error status codes, just pass them back to the client
            validateStatus: () => true,
        });

        res.status(response.status).json(response.data);
    } catch (error: any) {
        console.error('[Healthians Proxy Error]', error.message);
        res.status(500).json({ error: 'Proxy forwarding failed', details: error.message });
    }
});

export default router;
