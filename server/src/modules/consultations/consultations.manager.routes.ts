/**
 * Manager portal: consultation reports. Managers and super admins (requireManager).
 * Logistics only: names, times and statuses, never clinical notes or prescriptions.
 */
import { Response, Router } from 'express';
import { authMiddleware, AuthRequest } from '../../middleware/auth';
import { requireManager } from '../../middleware/requireManager';
import { attendanceCsv, attendanceQuery, buildAttendanceReport } from './consultations.attendance';
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
    return buildAttendanceReport(parse.data);
}

// No-shows and late joins, per doctor and per patient.
consultManagerRoutes.get('/attendance', ...mgr, async (req: AuthRequest, res: Response) => {
    try {
        const r = await report(req, res);
        if (r) res.json(r);
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
