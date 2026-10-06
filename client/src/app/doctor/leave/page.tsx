'use client';
import { LeaveList } from '@/components/doctor/LeaveList';

export default function LeavePage() {
    return (
        <div className="space-y-4">
            <div>
                <h1 className="text-2xl font-bold text-foreground">Leave</h1>
                <p className="text-sm text-muted-foreground">Block out days or hours when you are away.</p>
            </div>
            <LeaveList />
        </div>
    );
}
