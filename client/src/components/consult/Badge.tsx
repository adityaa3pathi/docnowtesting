import { cn } from '@/lib/utils';
import { toneClasses, type Tone } from '@/lib/consult/status';

export function Badge({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
    return <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold', toneClasses[tone], className)}>{children}</span>;
}
