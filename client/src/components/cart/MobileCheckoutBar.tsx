import { Loader2 } from 'lucide-react';

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
    return (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] p-4 z-40 md:hidden">
            <div className="flex items-center justify-between max-w-7xl mx-auto">
                <div>
                    <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Total Payable</p>
                    <p className="text-xl font-black text-gray-900">₹{finalPayable}</p>
                </div>
                <button
                    onClick={handleCheckout}
                    disabled={!selectedAddressId || !selectedDate || !selectedTime || freezingSlot || creatingOrder || !isSlotLocked}
                    className="bg-slate-900 text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                    {creatingOrder ? (
                        <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Placing...
                        </>
                    ) : (
                        "Checkout"
                    )}
                </button>
            </div>
            {(!selectedAddressId || !selectedDate || !selectedTime || !isSlotLocked) && (
                <p className="text-[10px] text-orange-500 text-center mt-2">
                    {!selectedAddressId ? "Select an address" : (!selectedDate || !selectedTime) ? "Select date & time" : "Lock the slot"} to proceed
                </p>
            )}
        </div>
    );
}
