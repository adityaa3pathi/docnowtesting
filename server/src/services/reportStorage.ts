/**
 * Report Storage Service
 *
 * Provider-neutral abstraction for storing and serving report PDFs.
 * Currently implements local filesystem storage for development.
 * Swap to S3/R2 by implementing ReportStorageProvider and changing REPORT_STORAGE_PROVIDER env.
 */
import fs from 'fs';
import path from 'path';

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

// ─── Local Filesystem Provider ──────────────────────────────────────────────

const STORAGE_DIR = process.env.REPORT_STORAGE_DIR ||
    path.join(__dirname, '../../storage/reports');

class LocalStorageProvider implements ReportStorageProvider {
    constructor() {
        // Ensure base directory exists
        if (!fs.existsSync(STORAGE_DIR)) {
            fs.mkdirSync(STORAGE_DIR, { recursive: true });
            console.log(`[ReportStorage] Created local storage dir: ${STORAGE_DIR}`);
        }
    }

    async upload(key: string, buffer: Buffer, _contentType: string): Promise<void> {
        const filePath = path.join(STORAGE_DIR, key);
        const dir = path.dirname(filePath);

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(filePath, buffer);
        console.log(`[ReportStorage] Stored locally: ${key} (${buffer.length} bytes)`);
    }

    async read(key: string): Promise<Buffer> {
        const filePath = path.join(STORAGE_DIR, key);
        if (!fs.existsSync(filePath)) {
            throw new Error(`Report file not found: ${key}`);
        }
        return fs.readFileSync(filePath);
    }

    async exists(key: string): Promise<boolean> {
        const filePath = path.join(STORAGE_DIR, key);
        return fs.existsSync(filePath);
    }

    async delete(key: string): Promise<void> {
        const filePath = path.join(STORAGE_DIR, key);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }
}

import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

// ─── S3 Storage Provider ────────────────────────────────────────────────────

class S3StorageProvider implements ReportStorageProvider {
    private client: S3Client;
    private bucket: string;

    constructor() {
        if (!process.env.AWS_S3_BUCKET || !process.env.AWS_S3_REGION || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
            throw new Error('Missing AWS S3 Environment Variables');
        }

        this.bucket = process.env.AWS_S3_BUCKET;
        this.client = new S3Client({
            region: process.env.AWS_S3_REGION,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            },
        });
        console.log(`[ReportStorage] Initialized S3 provider: s3://${this.bucket}`);
    }

    async upload(key: string, buffer: Buffer, contentType: string): Promise<void> {
        const command = new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: buffer,
            ContentType: contentType,
        });

        await this.client.send(command);
        console.log(`[ReportStorage] Stored in S3: s3://${this.bucket}/${key} (${buffer.length} bytes)`);
    }

    async read(key: string): Promise<Buffer> {
        const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
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
        const command = new HeadObjectCommand({
            Bucket: this.bucket,
            Key: key,
        });

        try {
            await this.client.send(command);
            return true;
        } catch (error: any) {
            if (error.name === 'NotFound') {
                return false;
            }
            throw error;
        }
    }

    async delete(key: string): Promise<void> {
        const command = new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: key,
        });

        await this.client.send(command);
    }
}

// ─── Provider Factory ───────────────────────────────────────────────────────

function createProvider(): ReportStorageProvider {
    const providerName = process.env.REPORT_STORAGE_PROVIDER || 'local';

    switch (providerName) {
        case 's3':
            return new S3StorageProvider();
        case 'local':
            return new LocalStorageProvider();
        default:
            console.warn(`[ReportStorage] Unknown provider "${providerName}", falling back to local.`);
            return new LocalStorageProvider();
    }
}

// ─── Singleton Export ───────────────────────────────────────────────────────

export const reportStorage = createProvider();

/**
 * Generate a storage key for a report PDF.
 * Format: {bookingId}/{reportId}.pdf
 */
export function reportStorageKey(bookingId: string, reportId: string): string {
    return `${bookingId}/${reportId}.pdf`;
}
