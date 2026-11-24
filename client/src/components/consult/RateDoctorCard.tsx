'use client';
/**
 * "Rate your doctor" on the booking page (P11): open for 48 h after the consultation ends, once. The
 * WhatsApp ask links here with #review. Afterwards the card shows the review as written.
 */
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';
import { consult } from '@/lib/consult/api';
import { formatIstDateTime } from '@/lib/consult/time';
import type { BookingReviewState, OwnReview } from '@/lib/consult/types';
import { OwnReviewView, ReviewForm } from './reviews';

export function RateDoctorCard({ bookingId, doctorName, state }: { bookingId: string; doctorName: string; state: BookingReviewState }) {
    const [written, setWritten] = useState<OwnReview | null>(state.review);
    const review = written ?? state.review;
    const show = !!review || state.canReview;

    // The WhatsApp link ends in #review: bring the card into view once it is on the page.
    useEffect(() => {
        if (show && typeof window !== 'undefined' && window.location.hash === '#review') document.getElementById('review')?.scrollIntoView({ block: 'center' });
    }, [show]);

    if (!show) return null;
    return (
        <Card id="review" className="scroll-mt-24 p-5">
            {review ? (
                <>
                    <h2 className="text-base font-bold text-ink">Thanks for rating {doctorName}</h2>
                    <OwnReviewView review={review} />
                </>
            ) : (
                <>
                    <h2 className="text-base font-bold text-ink">How was your consultation with {doctorName}?</h2>
                    <p className="mb-3 mt-1 text-sm text-ink-muted">
                        Your rating helps other patients choose.{state.closesAt && ` You can rate until ${formatIstDateTime(state.closesAt)}.`} A review cannot be changed once sent.
                    </p>
                    <ReviewForm
                        submitLabel="Send review"
                        placeholder="What went well, and what could be better?"
                        onSubmit={async (body) => setWritten(await consult.review(bookingId, body))}
                    />
                </>
            )}
        </Card>
    );
}
