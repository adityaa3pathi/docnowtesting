'use client';
import { useEffect, useRef, type HTMLAttributes } from 'react';

// Height of every bar on screen; the tallest one is published as --sticky-bottom on <html>.
const heights = new Map<symbol, number>();

function publish() {
    const tallest = Math.max(0, ...heights.values());
    document.documentElement.style.setProperty('--sticky-bottom', `${tallest}px`);
}

/**
 * A bar fixed to the bottom of the screen that reserves its space, so floating buttons (the
 * support chat) sit above it instead of on its main action. Hidden bars (md:hidden) count as 0.
 */
export function StickyBottomBar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const id = Symbol('sticky-bottom');
        const observer = new ResizeObserver(() => {
            heights.set(id, el.offsetHeight);
            publish();
        });
        observer.observe(el);
        return () => {
            observer.disconnect();
            heights.delete(id);
            publish();
        };
    }, []);

    return <div ref={ref} className={`fixed bottom-0 left-0 right-0 ${className ?? ''}`} {...props} />;
}
