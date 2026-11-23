/**
 * Doctor photos: stored privately, served through a stable DocNow link that redirects to a fresh
 * signed link, so a saved photoUrl never expires the way a 7-day signed link would.
 */
import { prisma } from '../../db';
import { deleteImage, refreshPresignedUrl, uploadImage } from '../../services/imageUpload';
import { logger } from '../../utils/logger';
import { DoctorError } from './doctors.status';

export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

/** Real image type from the file's first bytes; the browser-sent type is not trusted. */
export function sniffImageType(buf: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    return null;
}

/** Checks the bytes are a real photo, then stores them; returns the storage key. */
export async function storeDoctorPhoto(buffer: Buffer): Promise<string> {
    const type = sniffImageType(buffer);
    if (!type) throw new DoctorError(400, 'Upload a JPG, PNG or WebP photo');
    if (buffer.length > MAX_PHOTO_BYTES) throw new DoctorError(413, 'Photos can be up to 3 MB');
    const ext = type.split('/')[1].replace('jpeg', 'jpg');
    const { key } = await uploadImage(buffer, `photo.${ext}`, type, 'doctor-photos', MAX_PHOTO_BYTES);
    return key;
}

/** The stable DocNow link saved as photoUrl; `v` makes browsers fetch a replaced photo afresh. */
export const doctorPhotoUrl = (publicBase: string, doctorId: string) => `${publicBase}/api/consult/doctors/${doctorId}/photo?v=${Date.now()}`;

/** Drops a stored photo file without failing the request that replaced or abandoned it. */
export function discardDoctorPhoto(key: string) {
    deleteImage(key).catch((err) => logger.warn({ error: err }, 'doctor_photo_old_delete_failed'));
}

async function replacePhoto(doctor: { id: string; photoKey: string | null }, buffer: Buffer, publicBase: string) {
    const key = await storeDoctorPhoto(buffer);
    const photoUrl = doctorPhotoUrl(publicBase, doctor.id);
    await prisma.doctorProfile.update({ where: { id: doctor.id }, data: { photoKey: key, photoUrl } });
    if (doctor.photoKey && doctor.photoKey !== key) discardDoctorPhoto(doctor.photoKey);
    return { photoUrl };
}

/** Saves a new photo for the signed-in doctor (any status, so applicants can add one) and drops the old file. */
export async function saveDoctorPhoto(userId: string, buffer: Buffer, publicBase: string) {
    const doctor = await prisma.doctorProfile.findUnique({ where: { userId }, select: { id: true, photoKey: true } });
    if (!doctor) throw new DoctorError(404, 'No doctor profile');
    return replacePhoto(doctor, buffer, publicBase);
}

/** A super admin adds or replaces a doctor's photo, e.g. for a doctor who went live without one. */
export async function adminSaveDoctorPhoto(doctorId: string, buffer: Buffer, publicBase: string) {
    const doctor = await prisma.doctorProfile.findUnique({ where: { id: doctorId }, select: { id: true, photoKey: true } });
    if (!doctor) throw new DoctorError(404, 'Doctor not found');
    return replacePhoto(doctor, buffer, publicBase);
}

/** A fresh signed link for the doctor's stored photo, or null when there is none. */
export async function doctorPhotoLink(doctorId: string): Promise<string | null> {
    const d = await prisma.doctorProfile.findUnique({ where: { id: doctorId }, select: { photoKey: true } });
    return d?.photoKey ? refreshPresignedUrl(d.photoKey) : null;
}
