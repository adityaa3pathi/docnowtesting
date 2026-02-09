
import { useMemo } from "react";
import { Clock, Loader2, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SlotSelectorProps {
    slots: any[];
    selectedDate: string;
    selectedTime: string;
    loading: boolean;
    freezingSlot?: boolean;
    isSlotLocked?: boolean;
    onDateSelect: (date: string) => void;
    onTimeSelect: (time: string) => void;
    onFreezeSlot: () => void;
}

export function SlotSelector({
    slots,
    selectedDate,
    selectedTime,
    loading,
    freezingSlot = false,
    isSlotLocked = false,
    onDateSelect,
    onTimeSelect,
    onFreezeSlot
}: SlotSelectorProps) {

    // Generate next 7 days
    const next7Days = useMemo(() => {
        return Array.from({ length: 7 }, (_, i) => {
            const d = new Date();
            d.setDate(d.getDate() + i);
            return d.toISOString().split('T')[0];
        });
    }, []);

    return (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-primary" />
                2. Select Date & Time
            </h3>

            <div className="space-y-6">
                {/* Date selection - Always visible */}
                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                    {next7Days.map((dateStr) => {
                        const dateObj = new Date(dateStr);
                        const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
                        const dayNum = dateObj.getDate();
                        const monthName = dateObj.toLocaleDateString('en-US', { month: 'short' });

                        return (
                            <button
                                key={dateStr}
                                onClick={() => onDateSelect(dateStr)}
                                className={cn(
                                    "flex-shrink-0 flex flex-col items-center justify-center w-20 h-24 rounded-2xl border transition-all",
                                    selectedDate === dateStr
                                        ? "bg-primary border-primary text-white shadow-lg shadow-primary/20 scale-105"
                                        : "bg-white border-gray-100 hover:border-primary/50 text-gray-700 hover:bg-primary/5"
                                )}
                            >
                                <span className="text-xs font-medium opacity-80 uppercase tracking-wider">{dayName}</span>
                                <span className="text-2xl font-bold my-1">{dayNum}</span>
                                <span className="text-xs font-medium opacity-80">{monthName}</span>
                            </button>
                        );
                    })}
                </div>

                {/* Time selection */}
                {selectedDate && (
                    <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                        <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                            <Clock className="w-4 h-4 text-primary" />
                            Available Times
                        </h4>

                        {loading ? (
                            <div className="text-center py-8">
                                <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto mb-2" />
                                <p className="text-xs text-gray-400">Fetching available items...</p>
                            </div>
                        ) : slots.length > 0 ? (
                            <div className="space-y-4">
                                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                                    {slots.map((slot: any) => (
                                        <button
                                            key={slot.stm_id || slot.slot_time}
                                            onClick={() => onTimeSelect(slot.slot_time)}
                                            className={cn(
                                                "py-2 px-3 rounded-lg text-sm font-medium border transition-all",
                                                selectedTime === slot.slot_time
                                                    ? "bg-primary border-primary text-white shadow-md shadow-primary/20"
                                                    : "bg-white border-gray-100 hover:border-primary/50 text-gray-700 hover:bg-primary/5"
                                            )}
                                        >
                                            {slot.slot_time}
                                        </button>
                                    ))}
                                </div>

                                {/* Lock Slot Button */}
                                <div className="flex justify-end pt-2">
                                    <button
                                        onClick={onFreezeSlot}
                                        disabled={!selectedTime || freezingSlot || isSlotLocked}
                                        className={cn(
                                            "px-6 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all",
                                            isSlotLocked
                                                ? "bg-green-600 text-white cursor-default"
                                                : "bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                                        )}
                                    >
                                        {freezingSlot ? (
                                            <>
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                Locking Slot...
                                            </>
                                        ) : isSlotLocked ? (
                                            <>
                                                Slot Locked ✓
                                            </>
                                        ) : (
                                            <>
                                                Lock Slot
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="text-center py-8 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                                <p className="text-sm text-gray-500">No slots available for this date.</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
