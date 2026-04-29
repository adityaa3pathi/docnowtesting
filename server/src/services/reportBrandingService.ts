import { promises as fs } from 'fs';
import path from 'path';
import { PDFDocument, rgb } from 'pdf-lib';

const HEADER_BAND_HEIGHT = 56;
const HEADER_BAND_RATIO = 0.65;
const FOOTER_BAND_HEIGHT = 24;

const DOCNOW_BAND = rgb(88 / 255, 5 / 255, 125 / 255); // #58057d

let cachedLogoBytes: Buffer | null = null;

export async function brandReportPdf(originalPdf: Buffer): Promise<Buffer> {
    const pdfDoc = await PDFDocument.load(originalPdf);
    const logoBytes = await loadLogoBytes();
    const logo = await pdfDoc.embedPng(logoBytes);
    const logoAspectRatio = logo.height / logo.width;

    for (const page of pdfDoc.getPages()) {
        const { width, height } = page.getSize();
        const bandStartX = Math.floor(width * (1 - HEADER_BAND_RATIO));
        const headerBandWidth = width - bandStartX + 1;
        const logoZoneWidth = bandStartX;
        const maxLogoWidth = Math.min(126, logoZoneWidth - 28);
        const logoWidth = Math.max(98, maxLogoWidth);
        const logoHeight = logoWidth * logoAspectRatio;
        const logoX = Math.max(14, (logoZoneWidth - logoWidth) / 2);
        const logoY = height - HEADER_BAND_HEIGHT + Math.max(5, (HEADER_BAND_HEIGHT - logoHeight) / 2);

        page.drawRectangle({
            x: 0,
            y: height - HEADER_BAND_HEIGHT,
            width: logoZoneWidth,
            height: HEADER_BAND_HEIGHT,
            color: rgb(1, 1, 1),
        });

        page.drawRectangle({
            x: bandStartX,
            y: height - HEADER_BAND_HEIGHT,
            width: headerBandWidth,
            height: HEADER_BAND_HEIGHT,
            color: DOCNOW_BAND,
        });

        page.drawImage(logo, {
            x: logoX,
            y: logoY,
            width: logoWidth,
            height: logoHeight,
        });

        page.drawRectangle({
            x: 0,
            y: 0,
            width,
            height: FOOTER_BAND_HEIGHT,
            color: DOCNOW_BAND,
        });
    }

    const brandedBytes = await pdfDoc.save();
    return Buffer.from(brandedBytes);
}

async function loadLogoBytes(): Promise<Buffer> {
    if (cachedLogoBytes) {
        return cachedLogoBytes;
    }

    const candidatePaths = [
        path.resolve(process.cwd(), 'assets', 'docnow-logo.png'),
        path.resolve(__dirname, '../../assets/docnow-logo.png'),
    ];

    for (const candidatePath of candidatePaths) {
        try {
            cachedLogoBytes = await fs.readFile(candidatePath);
            return cachedLogoBytes;
        } catch {
            // Try next path
        }
    }

    throw new Error('[ReportBranding] DOCNOW logo asset not found at server/assets/docnow-logo.png');
}
