/**
 * Outside medical records for a consultation: photos of old prescriptions, discharge summaries
 * or lab reports from another lab. The booker uploads them before paying; the booking claims them.
 *
 * They are health data, so: stored privately in S3 (never a public URL), the file type is read from
 * the bytes rather than trusted from the phone, and they are only ever handed out as signed links
 * that expire within the hour, to the booker, the accepted family member and the doctor.
 */
import { randomUUID } from 'crypto';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../db';
import { DoctorError } from './doctors.status';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_BOOKING = 5;
/** Uploads not claimed by a booking within this long cannot be attached any more. */
export const UNCLAIMED_TTL_MS = 24 * 3_600_000;
export const SIGNED_URL_SECONDS = 60 * 60;

export interface AttachmentStorage {
    put(key: string, body: Buffer, contentType: string): Promise<void>;
    remove(key: string): Promise<void>;
    signedUrl(key: string, seconds: number, fileName: string): Promise<string>;
}

let s3: { client: S3Client; bucket: string; prefix: string } | null = null;
function s3Config() {
    if (s3) return s3;
    const { AWS_S3_BUCKET: bucket, AWS_S3_REGION: region, AWS_ACCESS_KEY_ID: accessKeyId, AWS_SECRET_ACCESS_KEY: secretAccessKey } = process.env;
    if (!bucket || !region || !accessKeyId || !secretAccessKey) throw new DoctorError(503, 'File uploads are not set up yet');
    s3 = {
        client: new S3Client({ region, credentials: { accessKeyId, secretAccessKey } }),
        bucket,
        prefix: (process.env.CONSULT_ATTACHMENT_PREFIX || 'consult-attachments').replace(/^\/+|\/+$/g, ''),
    };
    return s3;
}

export const s3AttachmentStorage: AttachmentStorage = {
    async put(key, body, contentType) {
        const { client, bucket, prefix } = s3Config();
        // No public ACL and no caching: the object is only reachable through signed links.
        await client.send(new PutObjectCommand({ Bucket: bucket, Key: `${prefix}/${key}`, Body: body, ContentType: contentType, CacheControl: 'private, no-store' }));
    },
    async remove(key) {
        const { client, bucket, prefix } = s3Config();
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: `${prefix}/${key}` }));
    },
    async signedUrl(key, seconds, fileName) {
        const { client, bucket, prefix } = s3Config();
        const safe = fileName.replace(/[^\w.\- ]+/g, '_');
        return getSignedUrl(
            // client-s3 and s3-request-presigner pin different smithy versions; same cast as imageUpload.ts.
            client as unknown as Parameters<typeof getSignedUrl>[0],
            new GetObjectCommand({ Bucket: bucket, Key: `${prefix}/${key}`, ResponseContentDisposition: `inline; filename="${safe}"`, ResponseCacheControl: 'private, no-store' }),
            { expiresIn: seconds },
        );
    },
};

const TYPES = [
    { mime: 'image/jpeg', ext: 'jpg', test: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
    { mime: 'image/png', ext: 'png', test: (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
    { mime: 'image/webp', ext: 'webp', test: (b: Buffer) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
    // iPhone photos: an ISO media box whose brand is HEIC/HEIF.
    { mime: 'image/heic', ext: 'heic', test: (b: Buffer) => b.subarray(4, 8).toString('latin1') === 'ftyp' && /^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(b.subarray(8, 12).toString('latin1')) },
    { mime: 'application/pdf', ext: 'pdf', test: (b: Buffer) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
] as const;

/** The real type from the first bytes, or null for anything that is not an image or PDF. */
export function sniffType(buffer: Buffer): { mime: string; ext: string } | null {
    const t = TYPES.find((x) => buffer.length >= 12 && x.test(buffer));
    return t ? { mime: t.mime, ext: t.ext } : null;
}

/** A display name without paths or control characters, keeping the real extension. */
export function cleanFileName(original: string | undefined, ext: string): string {
    const base = (original ?? '').split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\.[^.]*$/, '').trim().slice(0, 80);
    return `${base || 'medical-record'}.${ext}`;
}

type Db = Pick<PrismaClient, 'consultationAttachment'>;
type Deps = { db?: Db; storage?: AttachmentStorage; now?: () => Date };

export interface AttachmentView {
    id: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    uploadedAt: Date;
    /** Signed, expires within the hour; fetch the consultation again for a fresh one. */
    url: string;
}

async function view(storage: AttachmentStorage, a: { id: string; name: string; mimeType: string; sizeBytes: number; createdAt: Date; storageKey: string }): Promise<AttachmentView> {
    return { id: a.id, name: a.name, mimeType: a.mimeType, sizeBytes: a.sizeBytes, uploadedAt: a.createdAt, url: await storage.signedUrl(a.storageKey, SIGNED_URL_SECONDS, a.name) };
}

export async function uploadAttachment(userId: string, file: { buffer: Buffer; originalname?: string }, deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const storage = deps.storage ?? s3AttachmentStorage;
    if (!file.buffer.length) throw new DoctorError(400, 'The file is empty');
    if (file.buffer.length > MAX_ATTACHMENT_BYTES) throw new DoctorError(413, 'Files can be up to 10 MB');
    const type = sniffType(file.buffer);
    if (!type) throw new DoctorError(415, 'Upload a photo (JPEG, PNG, WebP, HEIC) or a PDF');

    const id = randomUUID();
    const storageKey = `${userId}/${id}.${type.ext}`;
    await storage.put(storageKey, file.buffer, type.mime);
    const row = await db.consultationAttachment.create({
        data: { id, userId, storageKey, name: cleanFileName(file.originalname, type.ext), mimeType: type.mime, sizeBytes: file.buffer.length },
    });
    return view(storage, row);
}

/** Removes an upload the booker changed their mind about. Once a booking claimed it, it stays with the record. */
export async function removeAttachment(userId: string, id: string, deps: Deps = {}) {
    const db = deps.db ?? prisma;
    const storage = deps.storage ?? s3AttachmentStorage;
    const row = await db.consultationAttachment.findFirst({ where: { id, userId, consultationId: null } });
    if (!row) throw new DoctorError(404, 'Not found');
    await db.consultationAttachment.delete({ where: { id: row.id } });
    await storage.remove(row.storageKey).catch(() => {});
    return { id, removed: true };
}

/**
 * Inside the booking transaction: links the booker's own fresh, unclaimed uploads to the new
 * consultation. Anything else (someone else's file, an old one, one already used) fails the booking.
 */
export async function claimAttachments(tx: Pick<Prisma.TransactionClient, 'consultationAttachment'>, userId: string, consultationId: string, ids: string[], now: Date) {
    const unique = [...new Set(ids)];
    if (!unique.length) return 0;
    if (unique.length > MAX_ATTACHMENTS_PER_BOOKING) throw new DoctorError(400, `Attach at most ${MAX_ATTACHMENTS_PER_BOOKING} documents`);
    const res = await tx.consultationAttachment.updateMany({
        where: { id: { in: unique }, userId, consultationId: null, createdAt: { gt: new Date(now.getTime() - UNCLAIMED_TTL_MS) } },
        data: { consultationId },
    });
    if (res.count !== unique.length) throw new DoctorError(409, 'Some attached documents are no longer available. Please attach them again.');
    return res.count;
}

/** The consultation's documents with fresh signed links, for the booker, family member or doctor. */
export async function attachmentsFor(consultationId: string, deps: Deps = {}): Promise<AttachmentView[]> {
    const db = deps.db ?? prisma;
    const storage = deps.storage ?? s3AttachmentStorage;
    const rows = await db.consultationAttachment.findMany({ where: { consultationId }, orderBy: { createdAt: 'asc' } });
    if (!rows.length) return [];
    try {
        return await Promise.all(rows.map((r) => view(storage, r)));
    } catch {
        // Storage down: the visit still loads, without the documents.
        return [];
    }
}
