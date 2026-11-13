'use client';
import { Plus, Trash2 } from 'lucide-react';
import type { FieldArrayWithId, UseFormRegister } from 'react-hook-form';
import { Button } from '@/components/ui';
import type { ConsultRules } from '@/lib/consult/types';
import { inputCls } from './shared';

interface Props {
    fields: FieldArrayWithId<ConsultRules, 'refundTiers', 'key'>[];
    register: UseFormRegister<ConsultRules>;
    onAdd: () => void;
    onRemove: (index: number) => void;
    onSort: () => void;
}

export function RefundTiersEditor({ fields, register, onAdd, onRemove, onSort }: Props) {
    return (
        <fieldset className="space-y-3">
            <legend className="text-lg font-semibold text-gray-900">Refund tiers</legend>
            <p className="text-sm text-gray-500">The refund depends on how many hours are left before the visit. The last tier must start at 0 hours.</p>
            <ul className="space-y-3">
                {fields.map((f, i) => (
                    <li key={f.key} className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
                        <div>
                            <label htmlFor={`tier-h-${i}`} className="mb-1 block text-xs font-medium text-gray-700">Hours before visit (at least)</label>
                            <input id={`tier-h-${i}`} type="number" min={0} step="any" className={inputCls} {...register(`refundTiers.${i}.minHoursBefore`, { valueAsNumber: true })} />
                        </div>
                        <div>
                            <label htmlFor={`tier-p-${i}`} className="mb-1 block text-xs font-medium text-gray-700">Refund percent</label>
                            <input id={`tier-p-${i}`} type="number" min={0} max={100} step={1} className={inputCls} {...register(`refundTiers.${i}.percent`, { valueAsNumber: true })} />
                        </div>
                        <Button type="button" variant="outline" size="sm" onClick={() => onRemove(i)} aria-label={`Remove tier ${i + 1}`} className="h-10">
                            <Trash2 size={16} aria-hidden />
                        </Button>
                    </li>
                ))}
            </ul>
            <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={onAdd}><Plus size={14} aria-hidden className="mr-1" /> Add tier</Button>
                <Button type="button" variant="outline" size="sm" onClick={onSort}>Sort by hours</Button>
            </div>
        </fieldset>
    );
}
