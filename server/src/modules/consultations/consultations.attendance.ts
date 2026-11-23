/**
 * Manager report: who missed a consultation or joined late, per doctor and per patient, for a range
 * of IST days. Logistics only (times and statuses), never clinical notes.
 *
 * - Counted: consultations that were due, i.e. that took place or were missed. Bookings cancelled
 *   in time, unpaid holds and upcoming ones are left out.
 * - Doctor no-show: NO_SHOW_DOCTOR, or a DOCTOR_NO_SHOW refund (that also covers a patient who
 *   cancelled for a full refund because the doctor was late), the same rule as the super-admin
 *   doctor list.
 * - Patient no-show: NO_SHOW_PATIENT.
 * - Late: first joined more than LATE_AFTER_MINUTES after the start, the point where the app tells
 *   the patient their doctor is late.
 * - Not counted yet: a late doctor's booking that the patient moved to another time or doctor. The
 *   move repoints the consultation and keeps no record of the original time.
 */
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db';
import { istDayRange } from './consultations.appointments';
import { DOCTOR_LATE_AFTER_MS } from './consultations.room';
import { ConsultationStatus } from './consultations.types';
import { DoctorError } from './doctors.status';

export const LATE_AFTER_MINUTES = DOCTOR_LATE_AFTER_MS / 60_000;
export const MAX_RANGE_DAYS = 366;
/** Consultations loaded per report; past this the counts would be partial, so the report says so. */
export const MAX_CONSULTATIONS = 20_000;
/** Problem rows sent to the page; the CSV export has them all. */
export const MAX_ISSUES_SHOWN = 500;
const DAY_MS = 24 * 3_600_000;

// A real calendar day: 2026-02-31 would otherwise roll over to 3 March while the report still said 31 Feb.
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must be YYYY-MM-DD')
    .refine((d) => {
        const t = Date.parse(`${d}T00:00:00Z`);
        return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
    }, 'That date does not exist');
export const attendanceQuery = z.object({ from: isoDay.optional(), to: isoDay.optional() });
export type AttendanceQuery = z.infer<typeof attendanceQuery>;

/** The IST days asked for, as UTC instants. Defaults to the last 30 days, today included. */
export function attendanceRange(q: AttendanceQuery, now = new Date()) {
    const to = q.to ?? istDayRange(undefined, now).day;
    const from = q.from ?? new Date(Date.parse(`${to}T00:00:00Z`) - 29 * DAY_MS).toISOString().slice(0, 10);
    const { start } = istDayRange(from);
    const { end } = istDayRange(to);
    if (start >= end) throw new DoctorError(400, 'The start date must be on or before the end date');
    if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * DAY_MS) throw new DoctorError(400, `Pick a range of at most ${MAX_RANGE_DAYS} days`);
    return { from, to, start, end };
}

export type Outcome = 'ON_TIME' | 'LATE' | 'NO_SHOW' | 'NOT_JOINED';
type Side = { outcome: Outcome; joinedAt: Date | null; minutesLate: number | null };

function joinOutcome(joinedAt: Date | null, startsAt: Date): Side {
    if (!joinedAt) return { outcome: 'NOT_JOINED', joinedAt: null, minutesLate: null };
    const late = joinedAt.getTime() > startsAt.getTime() + DOCTOR_LATE_AFTER_MS;
    return { outcome: late ? 'LATE' : 'ON_TIME', joinedAt, minutesLate: late ? Math.floor((joinedAt.getTime() - startsAt.getTime()) / 60_000) : null };
}

/** How each side did in one consultation. */
export function classify(c: { status: ConsultationStatus | string; startsAt: Date; doctorJoinedAt: Date | null; patientJoinedAt: Date | null; doctorNoShowRefund: boolean }) {
    const doctor: Side = c.status === 'NO_SHOW_DOCTOR' || c.doctorNoShowRefund
        ? { outcome: 'NO_SHOW', joinedAt: c.doctorJoinedAt, minutesLate: null }
        : joinOutcome(c.doctorJoinedAt, c.startsAt);
    const patient: Side = c.status === 'NO_SHOW_PATIENT'
        ? { outcome: 'NO_SHOW', joinedAt: null, minutesLate: null }
        : joinOutcome(c.patientJoinedAt, c.startsAt);
    return { doctor, patient };
}

const select = {
    id: true, status: true, startsAt: true, doctorJoinedAt: true, patientJoinedAt: true,
    doctor: { select: { id: true, displayName: true } },
    patient: { select: { id: true, name: true } },
    user: { select: { mobile: true } },
    refunds: { where: { reason: 'DOCTOR_NO_SHOW' }, select: { id: true } },
} satisfies Prisma.ConsultationSelect;

/** Took place or was missed: the doctor-no-show refund catches ones that moved on to REFUNDED or a late-doctor cancel. */
const DUE: ConsultationStatus[] = ['IN_PROGRESS', 'COMPLETED', 'NO_SHOW_PATIENT', 'NO_SHOW_DOCTOR'];

type Tally = { consultations: number; noShows: number; late: number; lateMinutes: number };
const tally = (): Tally => ({ consultations: 0, noShows: 0, late: 0, lateMinutes: 0 });
function count(t: Tally, side: Side) {
    t.consultations++;
    if (side.outcome === 'NO_SHOW') t.noShows++;
    if (side.outcome === 'LATE') {
        t.late++;
        t.lateMinutes += side.minutesLate ?? 0;
    }
}
const summary = ({ lateMinutes, ...t }: Tally) => ({ ...t, avgMinutesLate: t.late ? Math.round(lateMinutes / t.late) : null });
const worstFirst = (a: Tally & { name: string }, b: Tally & { name: string }) =>
    b.noShows - a.noShows || b.late - a.late || a.name.localeCompare(b.name);
/** A deleted account's mobile is a placeholder, not a number to call. */
const contact = (mobile: string) => (/^\d{10}$/.test(mobile) ? mobile : null);

export async function buildAttendanceReport(q: AttendanceQuery, now = new Date()) {
    const range = attendanceRange(q, now);
    const found = await prisma.consultation.findMany({
        where: {
            startsAt: { gte: range.start, lt: range.end },
            OR: [{ status: { in: DUE } }, { refunds: { some: { reason: 'DOCTOR_NO_SHOW' } } }],
        },
        select,
        orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
        take: MAX_CONSULTATIONS + 1,
    });
    const truncated = found.length > MAX_CONSULTATIONS;

    const doctors = new Map<string, Tally & { doctorId: string; name: string }>();
    const patients = new Map<string, Tally & { patientId: string; name: string; mobile: string | null }>();
    const totals = { consultations: 0, doctor: tally(), patient: tally() };
    const issues = [];

    for (const c of found.slice(0, MAX_CONSULTATIONS)) {
        const { doctor, patient } = classify({ ...c, doctorNoShowRefund: c.refunds.length > 0 });
        totals.consultations++;
        count(totals.doctor, doctor);
        count(totals.patient, patient);

        const d = doctors.get(c.doctor.id) ?? { ...tally(), doctorId: c.doctor.id, name: c.doctor.displayName };
        count(d, doctor);
        doctors.set(c.doctor.id, d);
        const p = patients.get(c.patient.id) ?? { ...tally(), patientId: c.patient.id, name: c.patient.name, mobile: contact(c.user.mobile) };
        count(p, patient);
        patients.set(c.patient.id, p);

        const flagged = (s: Side) => s.outcome === 'NO_SHOW' || s.outcome === 'LATE';
        if (flagged(doctor) || flagged(patient)) {
            issues.push({
                consultationId: c.id, startsAt: c.startsAt, status: c.status,
                doctorId: c.doctor.id, doctorName: c.doctor.displayName,
                patientId: c.patient.id, patientName: c.patient.name, mobile: contact(c.user.mobile),
                doctor, patient,
            });
        }
    }

    return {
        from: range.from,
        to: range.to,
        lateAfterMinutes: LATE_AFTER_MINUTES,
        truncated,
        totals: { consultations: totals.consultations, doctor: summary(totals.doctor), patient: summary(totals.patient) },
        // Every doctor with a due consultation, so their rate shows even with no issues.
        doctors: [...doctors.values()].sort(worstFirst).map(({ lateMinutes, ...d }) => summary({ ...d, lateMinutes })),
        // Only patients who missed or were late; the rest are not of interest here.
        patients: [...patients.values()].filter((p) => p.noShows || p.late).sort(worstFirst).map(({ lateMinutes, ...p }) => summary({ ...p, lateMinutes })),
        issues,
    };
}

export type AttendanceReport = Awaited<ReturnType<typeof buildAttendanceReport>>;

// ── CSV ─────────────────────────────────────────────────

const istDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
const istTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
const OUTCOME_LABEL: Record<Outcome, string> = { ON_TIME: 'On time', LATE: 'Late', NO_SHOW: 'No-show', NOT_JOINED: 'Did not join' };

/** Quoted, with a leading quote mark on text a spreadsheet would run as a formula (names are typed by patients). */
export function csvCell(value: unknown): string {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}

export function attendanceCsv(report: AttendanceReport): string {
    const headers = [
        'Date (IST)', 'Start (IST)', 'Doctor', 'Patient', 'Booked by (mobile)', 'Consultation status',
        'Doctor attendance', 'Doctor joined (IST)', 'Doctor minutes late', 'Patient attendance', 'Patient joined (IST)', 'Patient minutes late', 'Consultation ID',
    ];
    const rows = report.issues.map((r) => [
        istDate.format(r.startsAt), istTime.format(r.startsAt), r.doctorName, r.patientName, r.mobile ?? 'Deleted account', r.status,
        OUTCOME_LABEL[r.doctor.outcome], r.doctor.joinedAt ? istTime.format(r.doctor.joinedAt) : '', r.doctor.minutesLate ?? '',
        OUTCOME_LABEL[r.patient.outcome], r.patient.joinedAt ? istTime.format(r.patient.joinedAt) : '', r.patient.minutesLate ?? '',
        r.consultationId,
    ].map(csvCell).join(','));
    // BOM so Excel opens names in Hindi correctly.
    return '﻿' + [headers.map(csvCell).join(','), ...rows].join('\r\n');
}
