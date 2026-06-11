import { describe, expect, it, vi } from 'vitest';
import { getCancelDenialMessage, resolveHealthiansStatus } from './healthiansStatusMap';

describe('healthiansStatusMap', () => {
    it('maps known Healthians status codes to DocNow statuses and actions', () => {
        expect(resolveHealthiansStatus('BS003')).toMatchObject({
            docnowStatus: 'Cancelled',
            isFinal: true,
            action: 'cancel',
        });

        expect(resolveHealthiansStatus('BS0013')).toMatchObject({
            docnowStatus: 'Rescheduled',
            action: 'reschedule',
        });

        expect(resolveHealthiansStatus('BS018')).toMatchObject({
            docnowStatus: 'Resample Required',
            action: 'resample',
        });
    });

    it('falls back safely for unknown Healthians status codes', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        expect(resolveHealthiansStatus('BS999')).toMatchObject({
            docnowStatus: 'Processing Update Received',
            isFinal: false,
            action: 'update',
        });
        expect(warn).toHaveBeenCalledOnce();
    });

    it('keeps internal BS codes out of generic cancellation denial messages', () => {
        expect(getCancelDenialMessage('BS007')).toBe(
            'Your sample has already been collected. Cancellation is no longer available.'
        );
        expect(getCancelDenialMessage('BS999')).not.toContain('BS999');
    });
});
