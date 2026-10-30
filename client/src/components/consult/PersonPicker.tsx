'use client';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Person {
    id: string;
    name: string;
    relation: string;
    age: number;
    gender: string;
}

interface Props {
    people: Person[];
    value: string;
    onChange: (id: string) => void;
    onAdd: () => void;
}

export function PersonPicker({ people, value, onChange, onAdd }: Props) {
    return (
        <fieldset>
            <legend className="text-sm font-bold text-foreground">Who is this visit for?</legend>
            {people.length === 0 && (
                <p className="mt-2 text-sm text-muted-foreground">You have no saved people yet. Add yourself or a family member to continue.</p>
            )}
            <div role="radiogroup" aria-label="Who is this visit for?" className="mt-2 space-y-2">
                {people.map((p) => {
                    const checked = p.id === value;
                    return (
                        <label
                            key={p.id}
                            className={cn(
                                'flex cursor-pointer items-center gap-3 rounded-xl border p-3 focus-within:ring-2 focus-within:ring-primary',
                                checked ? 'border-primary bg-primary/5' : 'border-border bg-white'
                            )}
                        >
                            <input type="radio" name="person" value={p.id} checked={checked} onChange={() => onChange(p.id)} className="h-4 w-4 accent-primary" />
                            <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold text-foreground">{p.name}</span>
                                <span className="block text-xs text-muted-foreground">
                                    {p.relation?.toLowerCase() === 'self' ? 'Me' : p.relation} · {p.age} years
                                </span>
                            </span>
                        </label>
                    );
                })}
            </div>
            <button type="button" onClick={onAdd} className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-primary">
                <Plus className="h-4 w-4" aria-hidden /> Add a person
            </button>
        </fieldset>
    );
}
