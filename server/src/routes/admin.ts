import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { requireSuperAdmin } from '../middleware/adminAuth';
import {
    getDashboardStats, getRevenueTrend, getHighValueOrders,
    listUsers, getUserDetails, updateUserStatus, updateUserRole,
    getConfigs, updateConfig,
    adjustWallet, getWalletLedger,
    getReferralStats,
    listOrders,
    getAuditLogs,
    listPromos, createPromo, updatePromo,
} from '../controllers/admin';

const router = Router();

console.log('Admin Router Loaded');

// All admin routes require authentication + super admin role
const admin = [authMiddleware, requireSuperAdmin] as const;

// ── Health ──────────────────────────────────────────────
router.get('/health', ...admin, (req: AuthRequest, res: Response) => {
    console.log('[Admin] Health check passed for:', req.adminName);
    res.json({
        status: 'ok',
        admin: req.adminName,
        timestamp: new Date().toISOString()
    });
});

// ── Dashboard Stats ────────────────────────────────────
router.get('/stats', ...admin, getDashboardStats);
router.get('/stats/revenue', ...admin, getRevenueTrend);
router.get('/stats/high-value', ...admin, getHighValueOrders);

// ── Users ──────────────────────────────────────────────
router.get('/users', ...admin, listUsers);
router.get('/users/:id', ...admin, getUserDetails);
router.put('/users/:id/status', ...admin, updateUserStatus);
router.put('/users/:id/role', ...admin, updateUserRole);

// ── System Config ──────────────────────────────────────
router.get('/config', ...admin, getConfigs);
router.put('/config/:key', ...admin, updateConfig);

// ── Wallets ────────────────────────────────────────────
router.post('/wallets/adjust', ...admin, adjustWallet);
router.get('/wallets/ledger', ...admin, getWalletLedger);

// ── Referrals ──────────────────────────────────────────
router.get('/referrals/stats', ...admin, getReferralStats);

// ── Orders ─────────────────────────────────────────────
router.get('/orders', ...admin, listOrders);

// ── Audit Logs ─────────────────────────────────────────
router.get('/audit-logs', ...admin, getAuditLogs);

// ── Promos ─────────────────────────────────────────────
router.get('/promos', ...admin, listPromos);
router.post('/promos', ...admin, createPromo);
router.put('/promos/:id', ...admin, updatePromo);

export default router;
