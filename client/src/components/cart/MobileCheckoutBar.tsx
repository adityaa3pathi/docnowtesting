import { Loader2, ShieldCheck } from 'lucide-react';

interface MobileCheckoutBarProps {
    finalPayable: number;
    handleCheckout: () => void;
    selectedAddressId: string;
    selectedDate: string;
    selectedTime: string;
    freezingSlot: boolean;
    creatingOrder: boolean;
    isSlotLocked: boolean;
}

export function MobileCheckoutBar({
    finalPayable,
    handleCheckout,
    selectedAddressId,
    selectedDate,
    selectedTime,
    freezingSlot,
    creatingOrder,
    isSlotLocked
}: MobileCheckoutBarProps) {
    const isReady = selectedAddressId && selectedDate && selectedTime && isSlotLocked && !freezingSlot;

    const hintText = !selectedAddressId
        ? "Select an address to continue"
        : (!selectedDate || !selectedTime)
            ? "Select date & time slot"
            : !isSlotLocked
                ? "Lock the slot to proceed"
                : null;

    return (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-[0_-4px_20px_rgba(0,0,0,0.1)] z-40 md:hidden safe-area-bottom">
            {hintText && (
                <div className="px-4 pt-2 pb-0">
                    <p className="text-[11px] text-orange-500 font-medium text-center">
                        {hintText}
                    </p>
                </div>
            )}
            <div className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                    <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Total Payable</p>
                    <p className="text-2xl font-black text-gray-900">₹{finalPayable}</p>
                </div>
                <button
                    onClick={handleCheckout}
                    disabled={!isReady || creatingOrder}
                    className="bg-primary text-white px-6 py-3.5 rounded-xl font-bold text-sm hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 flex-shrink-0 shadow-lg shadow-primary/20"
                >
                    {creatingOrder ? (
                        <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Placing...
                        </>
                    ) : (
                        <>
                            <ShieldCheck className="w-4 h-4" />
                            Pay ₹{finalPayable}
                        </>
                    )}
                </button>
            </div>
        </div>
    );
}
