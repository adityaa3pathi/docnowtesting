/**
 * Report Storage Service
 *
 * Report PDFs are stored in S3-compatible object storage only.
 * Local filesystem storage is intentionally disabled to avoid
 * losing reports on redeploy/restart in ephemeral environments.
 */

// ─── Provider Interface ─────────────────────────────────────────────────────

export interface ReportStorageProvider {
    /** Upload a file buffer to storage under the given key */
    upload(key: string, buffer: Buffer, contentType: string): Promise<void>;

    /** Read a file from storage and return as a Buffer */
    read(key: string): Promise<Buffer>;

    /** Check if a file exists in storage */
    exists(key: string): Promise<boolean>;

    /** Delete a file from storage */
    delete(key: string): Promise<void>;
}

import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

// ─── S3 Storage Provider ────────────────────────────────────────────────────

class S3StorageProvider implements ReportStorageProvider {
    private client: S3Client;
    private bucket: string;
    private basePrefix: string;

    constructor() {
        const bucket = process.env.AWS_S3_BUCKET;
        const region = process.env.AWS_S3_REGION;
        const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
        const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

        if (!bucket || !region || !accessKeyId || !secretAccessKey) {
            throw new Error(
                '[ReportStorage] Missing S3 configuration. ' +
                'Set AWS_S3_BUCKET, AWS_S3_REGION, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY.'
            );
        }

        this.bucket = bucket;
        this.basePrefix = (process.env.REPORT_STORAGE_PREFIX || 'reports').replace(/^\/+|\/+$/g, '');
        this.client = new S3Client({
            region,
            credentials: {
                accessKeyId,
                secretAccessKey,
            },
        });
        console.log(`[ReportStorage] Initialized S3 provider: s3://${this.bucket}/${this.basePrefix}`);
    }

    private resolveKey(key: string): string {
        const normalizedKey = key.replace(/^\/+/, '');
        return this.basePrefix ? `${this.basePrefix}/${normalizedKey}` : normalizedKey;
    }

    async upload(key: string, buffer: Buffer, contentType: string): Promise<void> {
        const objectKey = this.resolveKey(key);
        const command = new PutObjectCommand({
            Bucket: this.bucket,
            Key: objectKey,
            Body: buffer,
            ContentType: contentType,
        });

        await this.client.send(command);
        console.log(`[ReportStorage] Stored in S3: s3://${this.bucket}/${objectKey} (${buffer.length} bytes)`);
    }

    async read(key: string): Promise<Buffer> {
        const objectKey = this.resolveKey(key);
        const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key: objectKey,
        });

        const response = await this.client.send(command);
        const stream = response.Body as unknown as NodeJS.ReadableStream;
        
        return new Promise((resolve, reject) => {
            const chunks: any[] = [];
            stream.on('data', (chunk) => chunks.push(chunk));
            stream.on('error', reject);
            stream.on('end', () => resolve(Buffer.concat(chunks)));
        });
    }

    async exists(key: string): Promise<boolean> {
        const objectKey = this.resolveKey(key);
        const command = new HeadObjectCommand({
            Bucket: this.bucket,
            Key: objectKey,
        });

        try {
            await this.client.send(command);
            return true;
        } catch (error: any) {
            if (
                error.name === 'NotFound' ||
                error.name === 'NoSuchKey' ||
                error.$metadata?.httpStatusCode === 404
            ) {
                return false;
            }
            throw error;
        }
    }

    async delete(key: string): Promise<void> {
        const objectKey = this.resolveKey(key);
        const command = new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: objectKey,
        });

        await this.client.send(command);
    }
}

// ─── Singleton Export ───────────────────────────────────────────────────────

export const reportStorage = new S3StorageProvider();

/**
 * Generate a storage key for a report PDF.
 * Format inside the configured prefix: {bookingId}/{reportId}.pdf
 */
export function reportStorageKey(bookingId: string, reportId: string): string {
    return `${bookingId}/${reportId}.pdf`;
}
