import type { DiffRow } from '@/lib/consult/changes';
import { cn } from '@/lib/utils';

/** Before and after, one row per field. Changed rows are marked; on phones the columns stack. */
export function ChangeDiff({ rows, beforeLabel = 'Now', afterLabel = 'New', className }: { rows: DiffRow[]; beforeLabel?: string; afterLabel?: string; className?: string }) {
    return (
        <dl className={cn('divide-y divide-gray-100 rounded-xl border border-gray-100 bg-white text-sm', className)}>
            <div className="hidden px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 sm:grid sm:grid-cols-[9rem_1fr_1fr] sm:gap-3">
                <span />
                <span>{beforeLabel}</span>
                <span>{afterLabel}</span>
            </div>
            {rows.map((r) => (
                <div key={r.label} className={cn('grid gap-1 px-3 py-2 sm:grid-cols-[9rem_1fr_1fr] sm:gap-3', r.changed && 'bg-amber-50')}>
                    <dt className="font-semibold text-gray-900">
                        {r.label}
                        {r.changed && <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">Changed</span>}
                    </dt>
                    <dd className={cn('break-words text-gray-500', r.changed && 'line-through decoration-gray-400')}>
                        <span className="mr-1 font-medium text-gray-400 sm:hidden">{beforeLabel}:</span>{r.before}
                    </dd>
                    <dd className={cn('break-words', r.changed ? 'font-semibold text-gray-900' : 'text-gray-500')}>
                        <span className="mr-1 font-medium text-gray-400 sm:hidden">{afterLabel}:</span>{r.after}
                    </dd>
                </div>
            ))}
        </dl>
    );
}
