import { BookingStrategy } from './bookingStrategy';

/**
 * In-memory registry that maps strategy type identifiers to their implementations.
 *
 * Strategies are registered at application startup and resolved at runtime
 * based on booking properties (e.g. presence of a campId).
 */
const strategies = new Map<string, BookingStrategy>();

/**
 * Register a booking strategy so it can be resolved later.
 * @param strategy - The strategy instance to register.
 */
export function registerBookingStrategy(strategy: BookingStrategy): void {
    strategies.set(strategy.type, strategy);
}

/**
 * Resolve the appropriate booking strategy for a given booking.
 *
 * If the booking has a `campId`, the `'camp'` strategy is returned.
 * Otherwise the `'home-collection'` strategy is returned.
 *
 * @param booking - An object containing at least the optional `campId` field.
 * @returns The matching {@link BookingStrategy} implementation.
 * @throws Error if the resolved strategy type has not been registered.
 */
export function getBookingStrategy(booking: { campId?: string | null }): BookingStrategy {
    const type = booking.campId ? 'camp' : 'home-collection';
    const strategy = strategies.get(type);

    if (!strategy) {
        throw new Error(`No booking strategy registered for type: ${type}`);
    }

    return strategy;
}
