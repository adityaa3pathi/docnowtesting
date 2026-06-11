import { Router } from 'express';
import { deep, live, ready, webhookSummary } from '../controllers/health';

const router = Router();

router.get('/live', live);
router.get('/ready', ready);
router.get('/deep', deep);
router.get('/webhooks', webhookSummary);

export default router;
