import { Response } from 'express';
import { DoctorError } from './doctors.status';

/** Maps a module error to its status, and anything unexpected to a 500 with the label in the log. */
export function sendConsultError(res: Response, e: unknown, label: string) {
    if (e instanceof DoctorError) return res.status(e.status).json({ error: e.message });
    console.error(`${label} request failed:`, e);
    return res.status(500).json({ error: 'Internal Server Error' });
}
