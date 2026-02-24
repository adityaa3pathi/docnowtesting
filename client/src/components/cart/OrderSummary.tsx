import { MapPin, Calendar, FileText, Loader2 } from 'lucide-react';
import { Address, Patient } from '@/types/cart';

interface OrderSummaryProps {
    cartItemsCount: number;
    total: number;
    discountAmount: number;
    walletDeduction: number;
    finalPayable: number;
    selectedAddress: Address | undefined;
    selectedDate: string;
    selectedTime: string;
    billingPatientId: string;
    setBillingPatientId: (id: string) => void;
    patients: Patient[];
    handleCheckout: () => void;
    selectedAddressId: string;
    isSlotLocked: boolean;
    freezingSlot: boolean;
    creatingOrder: boolean;
}

export function OrderSummary({
    cartItemsCount,
    total,
    discountAmount,
    walletDeduction,
    finalPayable,
    selectedAddress,
    selectedDate,
    selectedTime,
    billingPatientId,
    setBillingPatientId,
    patients,
    handleCheckout,
    selectedAddressId,
    isSlotLocked,
    freezingSlot,
    creatingOrder
}: OrderSummaryProps) {
    return (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 sticky top-24">
            <h3 className="text-lg font-bold mb-4">Order Summary</h3>

            <div className="space-y-2 mb-6 text-sm">
                <div className="flex justify-between">
                    <span className="text-gray-500">Items ({cartItemsCount})</span>
                    <span className="font-medium">₹{total}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-gray-500">Sample Collection</span>
                    <span className="text-green-600 font-medium">FREE</span>
                </div>
                {discountAmount > 0 && (
                    <div className="flex justify-between text-green-600">
                        <span>Coupon Discount</span>
                        <span className="font-medium">- ₹{discountAmount}</span>
                    </div>
                )}
                {walletDeduction > 0 && (
                    <div className="flex justify-between text-[#4b2192]">
                        <span>Wallet Used</span>
                        <span className="font-medium">- ₹{walletDeduction}</span>
                    </div>
                )}
            </div>

            {selectedAddress && (
                <div className="mb-4 p-3 bg-gray-50 rounded-lg text-xs space-y-2 border border-gray-100">
                    <div className="flex items-start gap-2">
                        <MapPin className="w-3.5 h-3.5 text-primary mt-0.5" />
                        <div>
                            <div className="font-bold text-gray-700">Collection at:</div>
                            <div className="text-gray-500 line-clamp-1">{selectedAddress.line1}</div>
                            <div className="text-gray-500">{selectedAddress.city} - {selectedAddress.pincode}</div>
                        </div>
                    </div>

                    {selectedDate && selectedTime && (
                        <div className="flex items-start gap-2 pt-2 border-t border-gray-200">
                            <Calendar className="w-3.5 h-3.5 text-primary mt-0.5" />
                            <div>
                                <div className="font-bold text-gray-700">Scheduled for:</div>
                                <div className="text-gray-500">
                                    {new Date(selectedDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                                </div>
                                <div className="text-gray-500 font-medium">{selectedTime}</div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="border-t border-gray-100 pt-4 mb-4">
                <label className="text-xs text-gray-500 font-medium mb-1.5 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" /> Invoice Name
                    <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <select
                    value={billingPatientId}
                    onChange={(e) => setBillingPatientId(e.target.value)}
                    className="w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2"
                >
                    <option value="self">Self</option>
                    {patients.map((patient) => (
                        <option key={patient.id} value={patient.id}>
                            {patient.name} ({patient.relation})
                        </option>
                    ))}
                </select>
            </div>

            <div className="border-t border-gray-100 pt-4 mb-6">
                <div className="flex justify-between text-lg font-bold">
                    <span>Total</span>
                    <span>₹{finalPayable}</span>
                </div>
            </div>

            <button
                onClick={handleCheckout}
                className="hidden md:flex w-full bg-slate-900 text-white rounded-xl py-4 font-bold hover:bg-slate-800 transition-colors shadow-lg shadow-slate-900/10 disabled:opacity-50 disabled:cursor-not-allowed items-center justify-center gap-2"
                disabled={!selectedAddressId || !selectedDate || !selectedTime || freezingSlot || creatingOrder || !isSlotLocked}
            >
                {creatingOrder ? (
                    <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Placing Order...
                    </>
                ) : (
                    "Proceed to Checkout"
                )}
            </button>

            <div className="mt-4 space-y-1 hidden md:block">
                {!selectedAddressId && (
                    <p className="text-[10px] text-red-500 text-center flex items-center justify-center gap-1">
                        • Address selection required
                    </p>
                )}
                {(!selectedDate || !selectedTime) && selectedAddressId && (
                    <p className="text-[10px] text-orange-500 text-center flex items-center justify-center gap-1">
                        • Date & time selection required
                    </p>
                )}
                {selectedDate && selectedTime && !isSlotLocked && (
                    <p className="text-[10px] text-red-500 text-center flex items-center justify-center gap-1">
                        • Please lock the selected slot to proceed
                    </p>
                )}
            </div>
        </div>
    );
}
