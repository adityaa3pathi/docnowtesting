'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/consult/States';
import { useApi } from '@/hooks/useApi';
import { doctor as doctorApi, errorMessage } from '@/lib/consult/api';
import { validateLeave } from '@/lib/consult/availability';
import { formatIstDateTime } from '@/lib/consult/time';

const schema = z.object({
    startsAt: z.string().min(1, 'Choose when your leave starts.'),
    endsAt: z.string().min(1, 'Choose when your leave ends.'),
    reason: z.string().trim().max(200, 'Keep the reason under 200 characters.'),
}).superRefine((v, ctx) => {
    if (!v.startsAt || !v.endsAt) return;
    const r = validateLeave(v.startsAt, v.endsAt);
    if ('error' in r) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: r.error });
});
type FormValues = z.infer<typeof schema>;

const fieldClass = 'h-11 w-full rounded-xl border border-border bg-white px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

export function LeaveList() {
    const leave = useApi(() => doctorApi.leave());
    const [formError, setFormError] = useState<string | null>(null);
    const [conflicts, setConflicts] = useState<number | null>(null);
    const [removing, setRemoving] = useState<string | null>(null);
    const [removeError, setRemoveError] = useState<string | null>(null);
    const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: { startsAt: '', endsAt: '', reason: '' },
    });

    const add = handleSubmit(async (v) => {
        setFormError(null);
        setConflicts(null);
        const range = validateLeave(v.startsAt, v.endsAt);
        if ('error' in range) return setFormError(range.error);
        try {
            const res = await doctorApi.addLeave({ ...range, ...(v.reason ? { reason: v.reason } : {}) });
            setConflicts(res.bookedConflicts);
            reset();
            await leave.refetch();
        } catch (e) {
            setFormError(errorMessage(e));
        }
    });

    const remove = async (id: string) => {
        setRemoving(id);
        setRemoveError(null);
        try {
            await doctorApi.removeLeave(id);
            await leave.refetch();
        } catch (e) {
            setRemoveError(errorMessage(e));
        } finally {
            setRemoving(null);
        }
    };

    const entries = [...(leave.data ?? [])].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

    return (
        <div className="space-y-6">
            <Card className="p-5">
                <h2 className="mb-3 font-bold text-foreground">Add leave</h2>
                <form onSubmit={add} noValidate className="space-y-4" aria-label="Add leave">
                    {formError && <div role="alert" className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-destructive">{formError}</div>}
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                            <label htmlFor="leave-start" className="mb-1 block text-sm font-semibold">From (Indian time)</label>
                            <input id="leave-start" type="datetime-local" className={fieldClass} aria-invalid={!!errors.startsAt} {...register('startsAt')} />
                            {errors.startsAt && <p role="alert" className="mt-1 text-xs font-medium text-destructive">{errors.startsAt.message}</p>}
                        </div>
                        <div>
                            <label htmlFor="leave-end" className="mb-1 block text-sm font-semibold">Until (Indian time)</label>
                            <input id="leave-end" type="datetime-local" className={fieldClass} aria-invalid={!!errors.endsAt} {...register('endsAt')} />
                            {errors.endsAt && <p role="alert" className="mt-1 text-xs font-medium text-destructive">{errors.endsAt.message}</p>}
                        </div>
                    </div>
                    <div>
                        <label htmlFor="leave-reason" className="mb-1 block text-sm font-semibold">Reason (optional)</label>
                        <input id="leave-reason" className={fieldClass} aria-invalid={!!errors.reason} {...register('reason')} />
                        {errors.reason && <p role="alert" className="mt-1 text-xs font-medium text-destructive">{errors.reason.message}</p>}
                    </div>
                    <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Adding...' : 'Add leave'}</Button>
                </form>
                {conflicts !== null && (
                    <div role="status" className={`mt-4 flex items-start gap-2 rounded-xl px-4 py-3 text-sm font-medium ${conflicts > 0 ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-700'}`}>
                        {conflicts > 0 && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
                        {conflicts > 0
                            ? `Your leave is added. ${conflicts} ${conflicts === 1 ? 'patient has' : 'patients have'} already booked in this time. Please contact the Docnow team about them.`
                            : 'Your leave is added. No patients were booked in this time.'}
                    </div>
                )}
            </Card>

            <section aria-labelledby="leave-heading">
                <h2 id="leave-heading" className="mb-3 font-bold text-foreground">Your leave</h2>
                {removeError && <div role="alert" className="mb-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-destructive">{removeError}</div>}
                {leave.loading && !leave.data ? <LoadingBlock label="Loading your leave" />
                    : leave.error ? <ErrorState message={leave.error} onRetry={leave.refetch} />
                    : entries.length === 0 ? <EmptyState title="No leave planned" body="Add leave above and patients will not be able to book you in that time." />
                    : (
                        <ul className="space-y-3">
                            {entries.map((l) => (
                                <li key={l.id}>
                                    <Card className="flex items-center justify-between gap-3 p-4">
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-foreground">{formatIstDateTime(l.startsAt)} to {formatIstDateTime(l.endsAt)}</p>
                                            {l.reason && <p className="truncate text-sm text-muted-foreground">{l.reason}</p>}
                                        </div>
                                        <Button variant="outline" size="sm" disabled={removing === l.id} onClick={() => remove(l.id)}
                                            aria-label={`Remove leave starting ${formatIstDateTime(l.startsAt)}`}>
                                            {removing === l.id ? 'Removing...' : 'Remove'}
                                        </Button>
                                    </Card>
                                </li>
                            ))}
                        </ul>
                    )}
            </section>
        </div>
    );
}
