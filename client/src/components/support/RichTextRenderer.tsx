import { cn } from '@/lib/utils';
import type { SupportBlock } from '@/lib/supportContent';

export function RichTextRenderer({
    blocks,
    className,
}: {
    blocks: SupportBlock[];
    className?: string;
}) {
    if (!blocks.length) {
        return null;
    }

    return (
        <div className={cn('space-y-4 text-sm leading-7 text-muted-foreground', className)}>
            {blocks.map((block, index) => {
                if (block.type === 'list') {
                    return (
                        <ul key={`${block.type}-${index}`} className="space-y-2">
                            {block.items.map((item) => (
                                <li key={item} className="flex items-start gap-3">
                                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                                    <span>{item}</span>
                                </li>
                            ))}
                        </ul>
                    );
                }

                return <p key={`${block.type}-${index}`}>{block.text}</p>;
            })}
        </div>
    );
}
