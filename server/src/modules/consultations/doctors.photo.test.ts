import { describe, expect, it, vi } from 'vitest';

vi.mock('../../db', () => ({ prisma: {} }));
vi.mock('../../services/imageUpload', () => ({}));
const { sniffImageType } = await import('./doctors.photo');

describe('sniffImageType', () => {
    it('trusts the file bytes, not the name or browser type', () => {
        expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
        expect(sniffImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
        expect(sniffImageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'binary'))).toBe('image/webp');
    });
    it('rejects anything else, including a PDF or a script renamed .jpg', () => {
        expect(sniffImageType(Buffer.from('%PDF-1.7'))).toBeNull();
        expect(sniffImageType(Buffer.from('<script>alert(1)</script>'))).toBeNull();
        expect(sniffImageType(Buffer.alloc(0))).toBeNull();
    });
});
