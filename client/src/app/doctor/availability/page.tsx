'use client';
import { WeeklyHours } from '@/components/doctor/WeeklyHours';

export default function AvailabilityPage() {
    return (
        <div className="space-y-4">
            <div>
                <h1 className="text-2xl font-bold text-foreground">Your hours</h1>
                <p className="text-sm text-muted-foreground">Set the times you see patients each week.</p>
            </div>
            <WeeklyHours />
        </div>
    );
}
