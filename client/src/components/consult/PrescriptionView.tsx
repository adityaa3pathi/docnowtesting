import { formatIstDateTime } from '@/lib/consult/time';
import type { Prescription } from '@/lib/consult/types';

/** Read-only prescription, shared by the patient booking page and the doctor's room. */
export function PrescriptionView({ prescription }: { prescription: Prescription }) {
    const { medicines, recommendedTests, advice, doctorSnapshot: doc } = prescription;
    return (
        <div className="space-y-4 text-sm">
            <p className="text-xs text-muted-foreground">
                Issued {formatIstDateTime(prescription.issuedAt)} by {doc.displayName}, {doc.qualification} (Reg. {doc.registrationNumber})
            </p>
            <section aria-label="Medicines">
                <h3 className="mb-2 font-bold text-foreground">Medicines</h3>
                {medicines.length === 0 ? (
                    <p className="text-muted-foreground">No medicines.</p>
                ) : (
                    <ol className="space-y-2">
                        {medicines.map((m, i) => (
                            <li key={i} className="rounded-xl bg-primary/5 px-3 py-2">
                                <p className="font-semibold text-foreground">{m.name}{m.dose && ` · ${m.dose}`}</p>
                                <p className="text-muted-foreground">{[m.frequency, m.duration, m.instructions].filter(Boolean).join(' · ')}</p>
                            </li>
                        ))}
                    </ol>
                )}
            </section>
            {recommendedTests.length > 0 && (
                <section aria-label="Recommended tests">
                    <h3 className="mb-2 font-bold text-foreground">Recommended tests</h3>
                    <ul className="list-inside list-disc space-y-1 text-foreground">
                        {recommendedTests.map((t) => <li key={t.code}>{t.name}</li>)}
                    </ul>
                </section>
            )}
            {advice && (
                <section aria-label="Advice">
                    <h3 className="mb-1 font-bold text-foreground">Advice</h3>
                    <p className="whitespace-pre-line text-foreground">{advice}</p>
                </section>
            )}
        </div>
    );
}
