/** Renders a prescription PDF from the stored record. The record never changes, so neither does the PDF. */
import PDFDocument from 'pdfkit';
import path from 'path';

const PURPLE = '#4b2192';
const TEXT = '#1F2937';
const MUTED = '#4B5563';
const LINE = '#E5E7EB';

type Medicine = { name: string; dose: string; frequency: string; duration: string; instructions: string };
type Doctor = { displayName: string; qualification: string; specialty: string; registrationNumber: string; registrationCouncil: string };
type Patient = { name: string; age: number | null; gender: string | null };

export type PrescriptionForPdf = {
    id: string;
    issuedAt: Date;
    medicines: unknown;
    recommendedTests: unknown;
    advice: string | null;
    doctorSnapshot: unknown;
    patientSnapshot: unknown;
};

const istDateTime = (d: Date) =>
    new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d).replace(/\//g, '-').replace(',', '') + ' IST';

export function renderPrescriptionPdf(p: PrescriptionForPdf): Promise<Buffer> {
    const doctor = p.doctorSnapshot as Doctor;
    const patient = p.patientSnapshot as Patient;
    const medicines = p.medicines as Medicine[];
    const tests = p.recommendedTests as { code: string; name: string }[];

    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Prescription ${p.id}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(Buffer.from(c)));
    const done = new Promise<Buffer>((resolve, reject) => {
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
    });

    const left = 48;
    const width = doc.page.width - 96;
    const rule = () => {
        doc.moveDown(0.6);
        doc.moveTo(left, doc.y).lineTo(left + width, doc.y).strokeColor(LINE).lineWidth(0.5).stroke();
        doc.moveDown(0.6);
    };
    const heading = (t: string) => doc.fillColor(PURPLE).font('Helvetica-Bold').fontSize(12).text(t, left);

    try {
        doc.image(path.resolve(process.cwd(), 'assets', 'docnow-logo.png'), left + width - 110, 40, { width: 110 });
    } catch {
        doc.fillColor(PURPLE).font('Helvetica-Bold').fontSize(20).text('DOCNOW', left, 44, { width, align: 'right' });
    }
    doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(22).text('Prescription', left, 44);
    doc.y = 100;

    doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(12).text(`Dr. ${doctor.displayName}`);
    doc.fillColor(MUTED).font('Helvetica').fontSize(10)
        .text(`${doctor.qualification} · ${doctor.specialty}`)
        .text(`Reg. No. ${doctor.registrationNumber} (${doctor.registrationCouncil})`);
    rule();

    const age = patient.age != null ? `${patient.age} yrs` : '';
    doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(11).text(`Patient: ${patient.name}`);
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text([age, patient.gender].filter(Boolean).join(' · ') || ' ')
        .text(`Date: ${istDateTime(p.issuedAt)}`);
    rule();

    if (medicines.length) {
        heading('Medicines');
        doc.moveDown(0.3);
        medicines.forEach((m, i) => {
            doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(11).text(`${i + 1}. ${m.name}`, left);
            const plan = [m.dose, m.frequency, m.duration].filter(Boolean).join(' · ');
            if (plan) doc.fillColor(TEXT).font('Helvetica').fontSize(10).text(plan, left + 14);
            if (m.instructions) doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(10).text(m.instructions, left + 14);
            doc.moveDown(0.4);
        });
        rule();
    }

    if (tests.length) {
        heading('Recommended tests');
        doc.moveDown(0.3);
        tests.forEach((t) => doc.fillColor(TEXT).font('Helvetica').fontSize(10).text(`• ${t.name}`, left));
        doc.fillColor(MUTED).fontSize(9).text('Book these on docnow.in from your consultation page.', left);
        rule();
    }

    if (p.advice) {
        heading('Advice');
        doc.moveDown(0.3);
        doc.fillColor(TEXT).font('Helvetica').fontSize(10).text(p.advice, left, doc.y, { width });
        rule();
    }

    doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text(
        `Issued electronically by Dr. ${doctor.displayName} through DocNow on ${istDateTime(p.issuedAt)}. ` +
        `Prescription ID ${p.id}. This prescription follows a teleconsultation.`,
        left, doc.y, { width },
    );

    doc.end();
    return done;
}
