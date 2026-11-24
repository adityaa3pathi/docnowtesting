/** P11: the WhatsApp "rate your doctor" ask goes once, 30 min after the end, while reviews are open. */
import { describe, expect, it, vi } from 'vitest';
import { dueNotices, REVIEW_ASK_DELAY_MS, sendDueNotices } from './consultations.notifications';
import { duePushes } from './consultations.push';
import { REVIEW_WINDOW_MS } from './consultations.reviews';

const ended = new Date('2026-11-24T10:00:00Z');
const base = {
    status: 'COMPLETED', startsAt: new Date(ended.getTime() - 20 * 60_000), createdAt: new Date('2026-11-20T00:00:00Z'),
    doctorJoinedAt: ended, patientJoinedAt: ended, slot: { endsAt: ended }, refunds: [], endedAt: ended, review: null,
};
const at = (ms: number) => new Date(ended.getTime() + ms);
const asks = (c: Parameters<typeof dueNotices>[0], now: Date) => dueNotices(c, now).filter(([k]) => k === 'REVIEW_REQUEST');

describe('review ask', () => {
    it('is due to the booker from 30 min after the end until the 48 h window closes', () => {
        expect(asks(base, at(REVIEW_ASK_DELAY_MS - 1))).toEqual([]);
        expect(asks(base, at(REVIEW_ASK_DELAY_MS))).toEqual([['REVIEW_REQUEST', 'patient']]);
        expect(asks(base, at(REVIEW_WINDOW_MS - 1))).toEqual([['REVIEW_REQUEST', 'patient']]);
        expect(asks(base, at(REVIEW_WINDOW_MS))).toEqual([]);
    });

    it('is not due once reviewed, for other outcomes, or without an end time', () => {
        const now = at(REVIEW_ASK_DELAY_MS);
        expect(asks({ ...base, review: { id: 'r1' } }, now)).toEqual([]);
        for (const status of ['IN_PROGRESS', 'NO_SHOW_DOCTOR', 'NO_SHOW_PATIENT', 'CANCELLED', 'REFUNDED']) {
            expect(asks({ ...base, status }, now)).toEqual([]);
        }
        expect(asks({ ...base, endedAt: null }, now)).toEqual([]);
    });

    it('is never sent as a mobile push (the app has no review screen yet)', () => {
        const row = { ...base, id: 'c1', prescriptions: [], patient: { relation: 'Self' } } as unknown as Parameters<typeof duePushes>[0];
        expect(duePushes(row, at(REVIEW_ASK_DELAY_MS)).map(([k]) => k)).not.toContain('REVIEW_REQUEST');
    });

    it('greets the booker on a family visit and links with ?review=1 (no #fragment)', async () => {
        const row = {
            ...base, id: 'c1', doctorId: 'd1', guestToken: null, familyJoinedAt: null, prescriptions: [],
            user: { mobile: '9000000003', name: 'Ravi Kumar' },
            doctor: { displayName: 'Meera Rao', user: { mobile: '9000000002' } },
            patient: { name: 'Kamla Devi', relation: 'Mother', phone: null, preferredLanguage: 'hi', linkedUserId: null, linkDeclinedAt: null },
        };
        const db = {
            consultation: { findMany: vi.fn().mockResolvedValue([row]) },
            consultationNotification: { create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) },
        };
        const send = vi.fn().mockResolvedValue({ id: 'wa-1' });
        await sendDueNotices({ db: db as never, send, now: at(REVIEW_ASK_DELAY_MS), templates: { REVIEW_REQUEST: 'review_ask' } });
        expect(send).toHaveBeenCalledTimes(1);
        const [mobile, template, , components] = send.mock.calls[0];
        expect([mobile, template]).toEqual(['9000000003', 'review_ask']);
        expect(components[0].parameters.map((p: { text: string }) => p.text)).toEqual(['Ravi Kumar', 'Dr. Meera Rao']);
        expect(components[1].parameters[0].text).toBe('consult/booking/c1?review=1');
    });
});
