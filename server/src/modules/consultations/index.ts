/**
 * Consultations Module — Public API
 *
 * Only these exports are importable by the rest of the codebase.
 * Internal module implementation details remain private.
 */
export { ConsultationStatus, ConsultationType } from './consultations.types';
export { assertTransition, canTransition } from './consultations.stateMachine';
