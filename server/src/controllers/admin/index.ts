// Admin Controllers — Barrel Export
export { getDashboardStats, getRevenueTrend, getHighValueOrders } from './stats';
export { listUsers, getUserDetails, updateUserStatus, updateUserRole } from './users';
export { getConfigs, updateConfig } from './config';
export { adjustWallet, getWalletLedger } from './wallets';
export { getReferralStats } from './referrals';
export { listOrders } from './orders';
export { getAuditLogs } from './audit';
export { listPromos, createPromo, updatePromo } from './promos';
export {
    listFeaturedPackages,
    searchCatalogForFeaturing,
    addFeaturedPackage,
    removeFeaturedPackage,
    reorderFeaturedPackages,
    toggleFeaturedActive
} from './featuredPackages';
export {
    listFeaturedTests,
    searchTestsForFeaturing,
    addFeaturedTest,
    removeFeaturedTest,
    reorderFeaturedTests,
    toggleFeaturedTestActive
} from './featuredTests';
