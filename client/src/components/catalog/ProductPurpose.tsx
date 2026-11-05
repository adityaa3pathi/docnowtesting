import { Target } from 'lucide-react';
import { Card } from '@/components/ui';
import { getCustomPurpose, getPurposeHeading } from '@/lib/productText';

type PurposeTone = 'purple' | 'teal' | 'blue';

// Literal class names so Tailwind keeps them; matches each page's accent colour.
const TONE_CLASSES: Record<PurposeTone, { card: string; icon: string }> = {
    purple: { card: 'shadow-purple-900/5', icon: 'text-purple-600' },
    teal: { card: 'shadow-teal-900/5', icon: 'text-teal-600' },
    blue: { card: 'shadow-blue-900/5', icon: 'text-blue-600' },
};

interface ProductPurposeProps {
    text?: string | null;
    tone?: PurposeTone;
    type: 'TEST' | 'PROFILE' | 'PACKAGE';
}

export function ProductPurpose({ text, tone = 'purple', type }: ProductPurposeProps) {
    const clean = getCustomPurpose(text);
    if (!clean) return null;

    const classes = TONE_CLASSES[tone];
    return (
        <Card className={`p-6 md:p-8 border-gray-100 shadow-xl ${classes.card}`}>
            <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-2">
                <Target className={`w-4 h-4 ${classes.icon}`} />
                {getPurposeHeading(type)}
            </h2>
            <p className="text-gray-700 leading-relaxed">{clean}</p>
        </Card>
    );
}
