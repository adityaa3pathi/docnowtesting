import { promises as fs } from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';

/**
 * Report Branding Service — Banner Overlay Approach
 *
 * Instead of drawing rectangles + computing logo coordinates per page,
 * we pre-design header & footer banners at the exact dimensions and
 * stamp them onto each page. This gives pixel-perfect design control
 * and makes future branding updates a simple asset swap — zero code changes.
 *
 * Banner assets:
 *   server/assets/docnow-header-banner.png  (1024×107px)
 *   server/assets/docnow-footer-banner.png  (1024×53px)
 *
 * The banners are scaled to fill the full page width, preserving
 * their aspect ratio to derive the on-page height automatically.
 */

// Aspect ratios derived from the source images.
// Header: 1024×107  → ratio = 107/1024 ≈ 0.10449
// Footer: 1024×53   → ratio = 53/1024  ≈ 0.05176
const HEADER_ASPECT_RATIO = 107 / 1024;
const FOOTER_ASPECT_RATIO = 53 / 1024;

let cachedHeaderBytes: Buffer | null = null;
let cachedFooterBytes: Buffer | null = null;

export async function brandReportPdf(originalPdf: Buffer): Promise<Buffer> {
    const pdfDoc = await PDFDocument.load(originalPdf);
    const headerBytes = await loadAsset('docnow-header-banner.png', 'header');
    const footerBytes = await loadAsset('docnow-footer-banner.png', 'footer');

    const headerImage = await pdfDoc.embedPng(headerBytes);
    const footerImage = await pdfDoc.embedPng(footerBytes);

    for (const page of pdfDoc.getPages()) {
        const { width, height } = page.getSize();

        // Scale banners to full page width, derive height from aspect ratio
        const headerHeight = width * HEADER_ASPECT_RATIO;
        const footerHeight = width * FOOTER_ASPECT_RATIO;

        // Header — anchored to top edge
        page.drawImage(headerImage, {
            x: 0,
            y: height - headerHeight,
            width,
            height: headerHeight,
        });

        // Footer — anchored to bottom edge
        page.drawImage(footerImage, {
            x: 0,
            y: 0,
            width,
            height: footerHeight,
        });
    }

    const brandedBytes = await pdfDoc.save();
    return Buffer.from(brandedBytes);
}

// ─── Asset Loader ───────────────────────────────────────────────────────────

async function loadAsset(filename: string, label: string): Promise<Buffer> {
    // Return from cache if available
    if (label === 'header' && cachedHeaderBytes) return cachedHeaderBytes;
    if (label === 'footer' && cachedFooterBytes) return cachedFooterBytes;

    const candidatePaths = [
        path.resolve(process.cwd(), 'assets', filename),
        path.resolve(__dirname, '../../assets', filename),
    ];

    for (const candidatePath of candidatePaths) {
        try {
            const bytes = await fs.readFile(candidatePath);
            // Cache for future calls
            if (label === 'header') cachedHeaderBytes = bytes;
            if (label === 'footer') cachedFooterBytes = bytes;
            return bytes;
        } catch {
            // Try next path
        }
    }

    throw new Error(`[ReportBranding] ${label} banner asset not found: ${filename}`);
}
