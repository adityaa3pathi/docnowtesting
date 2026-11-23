/**
 * Manager portal: consultation reports. Managers and super admins (requireManager).
 * Logistics only: names, times and statuses, never clinical notes or prescriptions.
 */
import { Response, Router } from 'express';
import { authMiddleware, AuthRequest } from '../../middleware/auth';
import { requireManager } from '../../middleware/requireManager';
import { attendanceCsv, attendanceQuery, buildAttendanceReport, MAX_ISSUES_SHOWN } from './consultations.attendance';
import { DoctorError } from './doctors.status';

export const consultManagerRoutes = Router();
const mgr = [authMiddleware, requireManager] as const;

function fail(res: Response, e: unknown, label: string) {
    if (e instanceof DoctorError) return res.status(e.status).json({ error: e.message });
    console.error(`[ConsultManager] ${label} failed:`, e);
    return res.status(500).json({ error: 'Internal Server Error' });
}

async function report(req: AuthRequest, res: Response) {
    const parse = attendanceQuery.safeParse(req.query);
    if (!parse.success) {
        res.status(400).json({ error: parse.error.issues[0].message });
        return null;
    }
    // Patients' names and mobiles: never kept by a browser or proxy cache.
    res.setHeader('Cache-Control', 'private, no-store');
    return buildAttendanceReport(parse.data);
}

// No-shows and late joins, per doctor and per patient.
consultManagerRoutes.get('/attendance', ...mgr, async (req: AuthRequest, res: Response) => {
    try {
        const r = await report(req, res);
        // The newest problems only; a long range can hold thousands, and the CSV has them all.
        if (r) res.json({ ...r, issues: r.issues.slice(0, MAX_ISSUES_SHOWN), issuesTotal: r.issues.length });
    } catch (e) { fail(res, e, 'attendance'); }
});

consultManagerRoutes.get('/attendance.csv', ...mgr, async (req: AuthRequest, res: Response) => {
    try {
        const r = await report(req, res);
        if (!r) return;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="consult-no-shows-${r.from}-to-${r.to}.csv"`);
        res.send(attendanceCsv(r));
    } catch (e) { fail(res, e, 'attendance csv'); }
});
