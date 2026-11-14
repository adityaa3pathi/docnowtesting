import { Loader2 } from 'lucide-react';

// Shared states live in components/ui; these re-exports keep the consult imports working.
export { EmptyState, ErrorState, Skeleton } from '@/components/ui';

export function LoadingBlock({ label = 'Loading' }: { label?: string }) {
    return (
        <div role="status" className="flex items-center justify-center gap-2 py-12 text-ink-muted">
            <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden />
            <span className="text-sm">{label}...</span>
        </div>
    );
}
