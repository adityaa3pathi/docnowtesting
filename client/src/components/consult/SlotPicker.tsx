'use client';
import { useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { formatIstTime, groupSlotsByDay } from '@/lib/consult/time';
import type { Slot } from '@/lib/consult/types';

interface Props {
    slots: Slot[];
    selectedId: string | null;
    onSelect: (slot: Slot) => void;
}

/** Moves focus along a row of buttons with the arrow keys. */
function arrowNav(e: React.KeyboardEvent, container: HTMLElement | null, selector: string) {
    const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'];
    if (!container || !keys.includes(e.key)) return;
    const items = Array.from(container.querySelectorAll<HTMLElement>(selector));
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    const next = items[(at + step + items.length) % items.length];
    next.focus();
    next.click();
}

export function SlotPicker({ slots, selectedId, onSelect }: Props) {
    const days = useMemo(() => groupSlotsByDay(slots), [slots]);
    const [chosenDay, setChosenDay] = useState<string | null>(null);
    const tabsRef = useRef<HTMLDivElement>(null);
    const chipsRef = useRef<HTMLDivElement>(null);

    const selectedDay = days.find((d) => d.slots.some((s) => s.id === selectedId))?.key;
    const activeKey = days.find((d) => d.key === chosenDay)?.key ?? selectedDay ?? days[0]?.key;
    const active = days.find((d) => d.key === activeKey);
    if (!active) return null;

    return (
        <div>
            <div
                ref={tabsRef}
                role="tablist"
                aria-label="Choose a day"
                onKeyDown={(e) => arrowNav(e, tabsRef.current, '[role="tab"]')}
                className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2"
            >
                {days.map((d) => (
                    <button
                        key={d.key}
                        type="button"
                        role="tab"
                        id={`day-${d.key}`}
                        aria-selected={d.key === activeKey}
                        aria-controls="slot-panel"
                        tabIndex={d.key === activeKey ? 0 : -1}
                        onClick={() => setChosenDay(d.key)}
                        className={cn(
                            'shrink-0 rounded-xl border px-4 py-2 text-sm font-semibold',
                            d.key === activeKey ? 'border-primary bg-primary text-white' : 'border-border bg-white hover:bg-accent'
                        )}
                    >
                        {d.label}
                    </button>
                ))}
            </div>
            <div id="slot-panel" role="tabpanel" aria-labelledby={`day-${active.key}`} className="mt-3">
                <div
                    ref={chipsRef}
                    role="radiogroup"
                    aria-label={`Times on ${active.label}, Indian time`}
                    onKeyDown={(e) => arrowNav(e, chipsRef.current, '[role="radio"]')}
                    className="grid grid-cols-3 gap-2 sm:grid-cols-4"
                >
                    {active.slots.map((slot, i) => {
                        const checked = slot.id === selectedId;
                        const tabbable = checked || (!active.slots.some((s) => s.id === selectedId) && i === 0);
                        return (
                            <button
                                key={slot.id}
                                type="button"
                                role="radio"
                                aria-checked={checked}
                                tabIndex={tabbable ? 0 : -1}
                                onClick={() => onSelect(slot)}
                                className={cn(
                                    'rounded-xl border px-2 py-2.5 text-sm font-semibold',
                                    checked ? 'border-primary bg-primary text-white' : 'border-border bg-white hover:border-primary'
                                )}
                            >
                                {formatIstTime(slot.startsAt)}
                            </button>
                        );
                    })}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">All times are Indian time.</p>
            </div>
        </div>
    );
}
