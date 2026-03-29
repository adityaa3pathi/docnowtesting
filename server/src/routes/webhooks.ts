/**
 * Webhook Routes
 *
 * Currently serves as a placeholder for future webhook sources.
 * The Healthians webhook handler is mounted directly in index.ts
 * (before express.json()) for raw body access.
 *
 * Future webhook sources that don't require raw body can be added here.
 */
import { Router } from 'express';

const router = Router();

// Future webhooks that accept parsed JSON can be mounted here
// e.g., router.post('/some-other-partner', someHandler);

export default router;
