'use client';
/** "Rate DocNow" (P11): one review of the app per account, which its author can change. */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { ErrorState, LoadingBlock } from '@/components/consult/States';
import { OwnReviewView, ReviewForm } from '@/components/consult/reviews';
import { consult, errorMessage } from '@/lib/consult/api';
import type { OwnReview } from '@/lib/consult/types';

export function AppReviewTab() {
    const [review, setReview] = useState<OwnReview | null | undefined>(undefined);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        let alive = true;
        consult.myAppReview()
            .then((r) => { if (alive) { setReview(r.review); setError(null); } })
            .catch((e) => { if (alive) setError(errorMessage(e)); });
        return () => { alive = false; };
    }, [attempt]);

    if (error) return <ErrorState message={error} onRetry={() => { setError(null); setAttempt((n) => n + 1); }} />;
    if (review === undefined) return <LoadingBlock label="Loading your review" />;

    const save = async (body: { rating: number; text?: string }) => {
        const res = await consult.saveAppReview(body);
        setReview(res.review);
        setEditing(false);
        setSaved(true);
    };

    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-xl font-bold text-ink">Rate DocNow</h2>
                <p className="text-sm text-ink-muted">How has DocNow been for you? Your review is shown publicly without your name.</p>
            </div>
            {saved && <p role="status" className="rounded-lg bg-success-soft px-3 py-2 text-sm font-semibold text-success-ink">Thanks, your review is saved.</p>}
            {review && !editing ? (
                <>
                    <OwnReviewView review={review} />
                    {review.status !== 'DELETED' && <Button variant="outline" onClick={() => { setEditing(true); setSaved(false); }}>Change my review</Button>}
                </>
            ) : (
                <ReviewForm
                    initial={review ?? undefined}
                    submitLabel={review ? 'Save changes' : 'Send review'}
                    placeholder="What do you like, and what should we improve?"
                    onSubmit={save}
                    onCancel={review ? () => setEditing(false) : undefined}
                />
            )}
        </div>
    );
}
