/**
 * S3 Image Upload Service
 *
 * Reuses the same S3 credentials as reportStorage.
 * Uploads images under a configurable prefix (default: "hero-banners/").
 * Returns a presigned read URL (valid 7 days) for serving the image.
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

const ALLOWED_MIME_TYPES = ['image/webp', 'image/png', 'image/jpeg', 'image/jpg'];
const MAX_FILE_SIZE = 500 * 1024; // 500 KB
const PRESIGNED_URL_EXPIRY = 7 * 24 * 60 * 60; // 7 days in seconds

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
 * Returns a presigned URL (valid 7 days) and the object key.
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

  const putCommand = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
    CacheControl: 'public, max-age=31536000, immutable',
  });

  await getS3Client().send(putCommand);
  console.log(`[ImageUpload] Uploaded to S3: ${key} (${buffer.length} bytes)`);

  // Generate presigned read URL
  const url = await refreshPresignedUrl(key);

  return { url, key };
}

/**
 * Generate a fresh presigned URL for an S3 key.
 */
export async function refreshPresignedUrl(key: string): Promise<string> {
  const bucket = getBucket();
  const getCommand = new GetObjectCommand({ Bucket: bucket, Key: key });
  const url = await getSignedUrl(getS3Client() as any, getCommand, { expiresIn: PRESIGNED_URL_EXPIRY });
  return url;
}

/**
 * Delete an image from S3 by its key.
 */
export async function deleteImage(key: string): Promise<void> {
  const bucket = getBucket();

  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  await getS3Client().send(command);
  console.log(`[ImageUpload] Deleted: ${key}`);
}
