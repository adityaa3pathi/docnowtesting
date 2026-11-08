import { forwardRef, useId } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// Shared building blocks for the "calm clinical" system (DESIGN.md). Tokens only: no raw hex or gray-*.

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /** `outline` is the old name for `secondary`. */
    variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
    size?: 'sm' | 'md' | 'lg';
    /** Shows a spinner and blocks clicks; keep the label so the user knows what is running. */
    loading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant = 'primary', size = 'md', loading = false, disabled, children, ...props }, ref) => {
        const variants = {
            primary: 'bg-primary text-on-primary hover:bg-primary-hover',
            secondary: 'border border-border-strong bg-surface text-ink hover:bg-surface-subtle',
            outline: 'border border-border-strong bg-surface text-ink hover:bg-surface-subtle',
            ghost: 'text-ink hover:bg-surface-muted',
            danger: 'bg-danger text-on-primary hover:bg-danger-ink',
        };
        // 44px is the default touch target; sm is for dense staff screens and inline actions.
        const sizes = {
            sm: 'h-9 px-3 text-sm',
            md: 'h-11 px-4 text-sm',
            lg: 'h-12 px-6 text-base',
        };
        return (
            <button
                ref={ref}
                disabled={disabled || loading}
                aria-busy={loading || undefined}
                className={cn(
                    'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    variants[variant],
                    sizes[size],
                    className
                )}
                {...props}
            >
                {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {children}
            </button>
        );
    }
);
Button.displayName = 'Button';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return <div className={cn('rounded-xl border border-border bg-surface', className)} {...props} />;
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    ({ className, ...props }, ref) => (
        <input
            ref={ref}
            className={cn(
                'flex h-11 w-full rounded-lg border border-border-strong bg-surface px-3 text-base text-ink placeholder:text-ink-subtle',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary',
                'disabled:cursor-not-allowed disabled:bg-surface-muted aria-[invalid=true]:border-danger',
                className
            )}
            {...props}
        />
    )
);
Input.displayName = 'Input';

/** Label above, hint or error below, wired up for screen readers. Pass the control as a render function. */
export function Field({ label, hint, error, children, className }: {
    label: string;
    hint?: string;
    error?: string | null;
    children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => React.ReactNode;
    className?: string;
}) {
    const id = useId();
    const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
    return (
        <div className={cn('space-y-1.5', className)}>
            <label htmlFor={id} className="block text-sm font-medium text-ink">{label}</label>
            {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
            {error ? (
                <p id={`${id}-error`} className="text-sm text-danger-ink">{error}</p>
            ) : hint ? (
                <p id={`${id}-hint`} className="text-sm text-ink-muted">{hint}</p>
            ) : null}
        </div>
    );
}

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'muted';

export const toneClasses: Record<Tone, string> = {
    success: 'bg-success-soft text-success-ink',
    warning: 'bg-warning-soft text-warning-ink',
    danger: 'bg-danger-soft text-danger-ink',
    info: 'bg-primary-soft text-primary',
    muted: 'bg-surface-muted text-ink-muted',
};

export function Badge({ tone = 'muted', children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
    return (
        <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', toneClasses[tone], className)}>
            {children}
        </span>
    );
}

const NOTICE_ICON = { success: CheckCircle2, warning: AlertTriangle, danger: AlertCircle, info: Info, muted: Info } as const;

/** One message plus an optional action. Errors and warnings are announced; others are polite. */
export function Notice({ tone = 'info', title, children, action, className }: {
    tone?: Tone;
    title?: string;
    children?: React.ReactNode;
    action?: React.ReactNode;
    className?: string;
}) {
    const Icon = NOTICE_ICON[tone];
    const urgent = tone === 'danger' || tone === 'warning';
    return (
        <div role={urgent ? 'alert' : 'status'} className={cn('flex gap-3 rounded-lg px-4 py-3 text-sm', toneClasses[tone], className)}>
            <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1 space-y-1">
                {title && <p className="font-medium">{title}</p>}
                {children && <div className={title ? 'opacity-90' : undefined}>{children}</div>}
                {action && <div className="pt-1">{action}</div>}
            </div>
        </div>
    );
}

export function Skeleton({ className }: { className?: string }) {
    return <div aria-hidden className={cn('animate-pulse rounded-lg bg-surface-muted motion-reduce:animate-none', className)} />;
}

export function EmptyState({ icon: Icon, title, body, action }: {
    icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
    title: string;
    body?: string;
    action?: React.ReactNode;
}) {
    return (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center">
            {Icon && <Icon className="mb-1 h-6 w-6 text-ink-subtle" aria-hidden />}
            <p className="font-medium text-ink">{title}</p>
            {body && <p className="max-w-sm text-sm text-ink-muted">{body}</p>}
            {action && <div className="mt-2">{action}</div>}
        </div>
    );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
    return (
        <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-danger-soft bg-danger-soft px-6 py-10 text-center">
            <AlertCircle className="h-6 w-6 text-danger" aria-hidden />
            <p className="text-sm font-medium text-danger-ink">{message}</p>
            {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>}
        </div>
    );
}

export { Button };
