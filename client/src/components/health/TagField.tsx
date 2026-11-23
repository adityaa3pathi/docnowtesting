'use client';
import { useId, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { addTag, addTags, TAG_MAX_LENGTH } from '@/lib/health';
import { cn } from '@/lib/utils';

interface Props {
    label: string;
    hint?: string;
    values: string[];
    onChange: (values: string[]) => void;
    /** Typed text not yet added; the form adds it on save so nothing typed is lost. */
    draft: string;
    onDraftChange: (draft: string) => void;
    placeholder?: string;
    /** One-tap entries shown under the field. */
    suggestions?: string[];
    tone?: 'warn' | 'plain';
    disabled?: boolean;
}

/** A list of short entries: type and press Enter or comma, or tap a suggestion. */
export function TagField({ label, hint, values, onChange, draft, onDraftChange, placeholder, suggestions = [], tone = 'plain', disabled }: Props) {
    const id = useId();
    const [error, setError] = useState<string | null>(null);

    function commit(text: string) {
        const next = addTags(values, text);
        setError(next.error ?? null);
        onChange(next.list);
        onDraftChange('');
    }

    const unused = suggestions.filter((s) => !values.some((v) => v.toLowerCase() === s.toLowerCase()));
    return (
        <div className="space-y-1.5">
            <label htmlFor={id} className="block text-sm font-medium text-ink">{label}</label>
            {values.length > 0 && (
                <ul className="flex flex-wrap gap-1.5" aria-label={label}>
                    {values.map((v) => (
                        <li key={v} className={cn('inline-flex items-center gap-1 rounded-full py-1 pl-3 pr-1 text-sm font-medium',
                            tone === 'warn' ? 'bg-danger-soft text-danger-ink' : 'bg-surface-muted text-ink')}>
                            {v}
                            <button type="button" disabled={disabled} onClick={() => onChange(values.filter((x) => x !== v))}
                                aria-label={`Remove ${v}`} className="rounded-full p-1 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                                <X className="h-3.5 w-3.5" aria-hidden />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            <div className="flex gap-2">
                <input
                    id={id}
                    value={draft}
                    disabled={disabled}
                    maxLength={TAG_MAX_LENGTH * 4}
                    placeholder={placeholder}
                    aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
                    onChange={(e) => {
                        const text = e.target.value;
                        if (/[,\n]/.test(text)) commit(text);
                        else onDraftChange(text);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            commit(draft);
                        } else if (e.key === 'Backspace' && !draft && values.length) {
                            onChange(values.slice(0, -1));
                        }
                    }}
                    className="flex h-11 w-full min-w-0 rounded-lg border border-border-strong bg-surface px-3 text-base text-ink placeholder:text-ink-subtle focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:bg-surface-muted"
                />
                <button type="button" disabled={disabled || !draft.trim()} onClick={() => commit(draft)} aria-label={`Add to ${label.toLowerCase()}`}
                    className="inline-flex h-11 shrink-0 items-center gap-1 rounded-lg border border-border-strong bg-surface px-3 text-sm font-medium text-ink hover:bg-surface-subtle disabled:opacity-50">
                    <Plus className="h-4 w-4" aria-hidden /> Add
                </button>
            </div>
            {unused.length > 0 && !disabled && (
                <div className="flex flex-wrap gap-1.5">
                    {unused.map((s) => (
                        <button key={s} type="button" onClick={() => {
                            const next = addTag(values, s);
                            setError(next.error ?? null);
                            onChange(next.list);
                        }}
                            className="rounded-full border border-dashed border-border-strong px-2.5 py-1 text-xs font-medium text-ink-muted hover:border-primary hover:text-primary">
                            + {s}
                        </button>
                    ))}
                </div>
            )}
            {error ? <p id={`${id}-error`} role="alert" className="text-sm text-danger-ink">{error}</p>
                : hint ? <p id={`${id}-hint`} className="text-sm text-ink-muted">{hint}</p> : null}
        </div>
    );
}
