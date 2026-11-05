import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
    return <div aria-hidden className={cn('animate-pulse rounded-xl bg-muted', className)} />;
}

export function LoadingBlock({ label = 'Loading' }: { label?: string }) {
    return (
        <div role="status" className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            <span className="text-sm">{label}...</span>
        </div>
    );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
    return (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-white px-6 py-12 text-center">
            <p className="font-bold text-foreground">{title}</p>
            {body && <p className="max-w-sm text-sm text-muted-foreground">{body}</p>}
            {action && <div className="mt-2">{action}</div>}
        </div>
    );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
    return (
        <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl border border-red-100 bg-red-50 px-6 py-10 text-center">
            <p className="text-sm font-semibold text-destructive">{message}</p>
            {onRetry && (
                <Button variant="outline" size="sm" onClick={onRetry}>
                    Try again
                </Button>
            )}
        </div>
    );
}
