/** Longest side of an uploaded doctor photo; phone photos shrink from MBs to ~150 KB. */
const MAX_SIDE = 800;

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** A JPEG no bigger than MAX_SIDE; falls back to the original file if the browser can't draw it. */
export async function shrinkPhoto(file: File): Promise<Blob> {
    try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
        return blob ?? file;
    } catch {
        return file;
    }
}
