import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export function getIndianDateString(date: Date = new Date(), offsetDays: number = 0): string {
    const d = new Date(date);
    if (offsetDays) {
        d.setDate(d.getDate() + offsetDays);
    }
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}
