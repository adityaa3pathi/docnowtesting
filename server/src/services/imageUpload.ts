/**
 * S3 Image Upload Service
 *
 * Reuses the same S3 credentials as reportStorage.
 * Uploads images under a configurable prefix (default: "hero-banners/").
 * Returns the public S3 URL after upload.
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

const ALLOWED_MIME_TYPES = ['image/webp', 'image/png', 'image/jpeg', 'image/jpg'];
const MAX_FILE_SIZE = 500 * 1024; // 500 KB

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (s3Client) return s3Client;

  const region = process.env.AWS_S3_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error('[ImageUpload] Missing AWS credentials in env');
  }

  s3Client = new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
  return s3Client;
}

function getBucket(): string {
  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket) throw new Error('[ImageUpload] AWS_S3_BUCKET not set');
  return bucket;
}

export interface UploadResult {
  url: string;
  key: string;
}

/**
 * Upload an image buffer to S3.
 * Returns the public URL and the object key.
 */
export async function uploadImage(
  buffer: Buffer,
  originalFilename: string,
  mimeType: string,
  folder: string = 'hero-banners'
): Promise<UploadResult> {
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new Error(`Invalid file type: ${mimeType}. Allowed: WebP, PNG, JPEG`);
  }

  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`File too large (${Math.round(buffer.length / 1024)} KB). Max: ${MAX_FILE_SIZE / 1024} KB`);
  }

  const ext = originalFilename.split('.').pop()?.toLowerCase() || 'webp';
  const key = `${folder}/${randomUUID()}.${ext}`;
  const bucket = getBucket();
  const region = process.env.AWS_S3_REGION;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
    CacheControl: 'public, max-age=31536000, immutable',
  });

  await getS3Client().send(command);

  const url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  console.log(`[ImageUpload] Uploaded: ${url} (${buffer.length} bytes)`);

  return { url, key };
}

/**
 * Delete an image from S3 by its key or full URL.
 */
export async function deleteImage(keyOrUrl: string): Promise<void> {
  const bucket = getBucket();
  // Extract key from full URL if needed
  let key = keyOrUrl;
  if (keyOrUrl.startsWith('https://')) {
    const urlObj = new URL(keyOrUrl);
    key = urlObj.pathname.replace(/^\//, '');
  }

  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  await getS3Client().send(command);
  console.log(`[ImageUpload] Deleted: ${key}`);
}
