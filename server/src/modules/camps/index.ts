/**
 * Camps Module — Public API
 * 
 * Only these exports are importable by the rest of the codebase.
 * Internal module implementation details remain private.
 */
export { campAdminRoutes, campPublicRoutes } from './camps.routes';
export { CampRegistrationStrategy } from './camps.registration';
