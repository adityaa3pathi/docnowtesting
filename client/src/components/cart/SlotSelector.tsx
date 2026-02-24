
import { useMemo } from "react";
import { Clock, Loader2, Calendar, Lock, CheckCircle2 } from 'lucide-react';
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
        <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-gray-100">
            <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-primary" />
                2. Select Date & Time
            </h3>

            <div className="space-y-6">
                {/* ── Date Picker ── */}
                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide -mx-1 px-1">
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
                                    "flex-shrink-0 flex flex-col items-center justify-center w-[60px] h-[76px] sm:w-20 sm:h-24 rounded-2xl border transition-all active:scale-95",
                                    selectedDate === dateStr
                                        ? "bg-primary border-primary text-white shadow-lg shadow-primary/20 scale-[1.03]"
                                        : "bg-white border-gray-100 hover:border-primary/50 text-gray-700 hover:bg-primary/5"
                                )}
                            >
                                <span className="text-[10px] sm:text-xs font-medium opacity-80 uppercase tracking-wider">{dayName}</span>
                                <span className="text-xl sm:text-2xl font-bold my-0.5 sm:my-1">{dayNum}</span>
                                <span className="text-[10px] sm:text-xs font-medium opacity-80">{monthName}</span>
                            </button>
                        );
                    })}
                </div>

                {/* ── Time Slot Grid ── */}
                {selectedDate && (
                    <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                        <div className="flex items-center gap-2 mb-4">
                            <Clock className="w-4 h-4 text-primary" />
                            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-[0.15em]">
                                Sample Time Slot
                            </h4>
                        </div>

                        {loading ? (
                            <div className="text-center py-10">
                                <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto mb-2" />
                                <p className="text-xs text-gray-400">Fetching available slots...</p>
                            </div>
                        ) : slots.length > 0 ? (
                            <div className="space-y-5">
                                {/* Slot pills grid */}
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {slots.map((slot: any) => {
                                        const isSelected = selectedTime === slot.slot_time;
                                        return (
                                            <button
                                                key={slot.stm_id || slot.slot_time}
                                                onClick={() => onTimeSelect(slot.slot_time)}
                                                className={cn(
                                                    "relative px-2.5 py-2.5 sm:px-3 rounded-lg text-xs sm:text-[13px] font-semibold border-2 transition-all duration-200 active:scale-[0.95]",
                                                    isSelected
                                                        ? "bg-primary/10 border-primary text-primary ring-2 ring-primary/20 shadow-sm"
                                                        : "bg-gray-50 border-gray-200 text-slate-700 hover:border-primary/40 hover:bg-primary/5"
                                                )}
                                            >
                                                {slot.slot_time}
                                                {isSelected && (
                                                    <CheckCircle2 className="absolute top-0.5 right-0.5 w-3 h-3 sm:w-3.5 sm:h-3.5 text-primary" />
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* Lock Slot Button */}
                                {selectedTime && (
                                    <div className="pt-2">
                                        <button
                                            onClick={onFreezeSlot}
                                            disabled={!selectedTime || freezingSlot || isSlotLocked}
                                            className={cn(
                                                "w-full sm:w-auto sm:ml-auto px-6 py-3 sm:py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.97]",
                                                isSlotLocked
                                                    ? "bg-green-600 text-white cursor-default shadow-md shadow-green-600/20"
                                                    : "bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
                                            )}
                                        >
                                            {freezingSlot ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    Locking Slot...
                                                </>
                                            ) : isSlotLocked ? (
                                                <>
                                                    <CheckCircle2 className="w-4 h-4" />
                                                    Slot Locked
                                                </>
                                            ) : (
                                                <>
                                                    <Lock className="w-4 h-4" />
                                                    Lock Slot
                                                </>
                                            )}
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="text-center py-10 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                                <Clock className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                                <p className="text-sm text-gray-500">No slots available for this date.</p>
                                <p className="text-xs text-gray-400 mt-1">Try selecting a different date</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
