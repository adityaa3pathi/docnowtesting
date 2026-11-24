'use client';
import { useCallback, useState } from 'react';
import { Star } from 'lucide-react';
import { Card } from '@/components/ui';
import { ReviewList, Stars } from '@/components/consult/reviews';
import { doctor as doctorApi } from '@/lib/consult/api';
import type { DoctorReviewPage, ReviewPage } from '@/lib/consult/types';

/** The doctor's own reviews, read-only (P11): no patient names, and nothing here can change them. */
export default function DoctorReviewsPage() {
    const [summary, setSummary] = useState<DoctorReviewPage | null>(null);
    const load = useCallback((page: number) => doctorApi.reviews(page), []);
    // The doctor endpoint's first page carries the average; the shared list only knows the page shape.
    const onLoaded = useCallback((first: Omit<ReviewPage, 'rating'>) => setSummary(first as DoctorReviewPage), []);

    return (
        <div className="space-y-4">
            <div>
                <h1 className="text-2xl font-bold text-ink">Reviews</h1>
                <p className="text-sm text-ink-muted">What patients said after their consultation. Reviews are anonymous and cannot be edited or removed from here.</p>
            </div>
            {summary && summary.total > 0 && summary.average !== null && (
                <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 p-5">
                    <Star className="h-8 w-8 fill-warning text-warning" aria-hidden />
                    <p className="text-3xl font-bold tabular-nums text-ink">{summary.average.toFixed(1)}</p>
                    <div>
                        <Stars value={summary.average} />
                        <p className="text-sm text-ink-muted">{summary.total} {summary.total === 1 ? 'review' : 'reviews'}</p>
                    </div>
                    <p className="w-full text-sm text-ink-muted sm:ml-auto sm:w-auto">
                        {summary.shownPublicly
                            ? 'Patients see this rating on your profile.'
                            : `Your rating shows on your profile once you have ${summary.minCountToShow} reviews.`}
                    </p>
                </Card>
            )}
            <Card className="px-5 py-1">
                <ReviewList load={load} onLoaded={onLoaded} empty="No reviews yet. Patients can rate you for 48 hours after a consultation." />
            </Card>
        </div>
    );
}
