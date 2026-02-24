import { Ticket, Tag, Loader2, ChevronUp, ChevronDown, Check, Wallet, X } from 'lucide-react';
import { AvailablePromo, AppliedPromo } from '@/types/cart';

interface PromoSectionProps {
    promoCode: string;
    setPromoCode: (code: string) => void;
    appliedPromo: AppliedPromo | null;
    availablePromos: AvailablePromo[];
    showPromoList: boolean;
    setShowPromoList: (show: boolean) => void;
    loadingPromos: boolean;
    verifyingPromo: boolean;
    promoError: string;
    applyPromo: () => void;
    removePromo: () => void;
    walletBalance: number;
    useWallet: boolean;
    setUseWallet: (use: boolean) => void;
    cartTotal: number;
}

export function PromoSection({
    promoCode,
    setPromoCode,
    appliedPromo,
    availablePromos,
    showPromoList,
    setShowPromoList,
    loadingPromos,
    verifyingPromo,
    promoError,
    applyPromo,
    removePromo,
    walletBalance,
    useWallet,
    setUseWallet,
    cartTotal
}: PromoSectionProps) {
    return (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 mt-4">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <Ticket className="w-5 h-5 text-gray-500" /> Offers & Benefits
            </h3>

            {!appliedPromo ? (
                <div className="space-y-3">
                    <div className="flex gap-2">
                        <div className="flex-1 relative">
                            <input
                                type="text"
                                placeholder="Enter Promo Code"
                                value={promoCode}
                                onChange={(e) => {
                                    setPromoCode(e.target.value.toUpperCase());
                                }}
                                onFocus={() => setShowPromoList(true)}
                                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4b2192]/20 focus:border-[#4b2192] text-sm font-medium uppercase placeholder:normal-case transition-all"
                            />
                        </div>
                        <button
                            onClick={applyPromo}
                            disabled={!promoCode || verifyingPromo}
                            className="px-5 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                        >
                            {verifyingPromo ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Apply'}
                        </button>
                    </div>
                    {promoError && (
                        <p className="text-xs text-red-500 flex items-center gap-1">
                            <X className="w-3 h-3" />{promoError}
                        </p>
                    )}

                    <button
                        onClick={() => setShowPromoList(!showPromoList)}
                        className="w-full flex items-center justify-between text-sm text-[#4b2192] font-medium py-1 hover:underline"
                    >
                        <span className="flex items-center gap-1.5">
                            <Tag className="w-3.5 h-3.5" />
                            {availablePromos.length > 0
                                ? `${availablePromos.length} coupon${availablePromos.length > 1 ? 's' : ''} available`
                                : 'View coupons'}
                        </span>
                        {showPromoList ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>

                    {showPromoList && (
                        <div className="space-y-2 max-h-64 overflow-y-auto pr-1 scrollbar-thin">
                            {loadingPromos ? (
                                <div className="flex items-center justify-center py-6">
                                    <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                                </div>
                            ) : availablePromos.length === 0 ? (
                                <div className="text-center py-6 text-sm text-gray-400">
                                    No coupons available right now
                                </div>
                            ) : (
                                availablePromos.map((promo) => {
                                    const isEligible = cartTotal >= promo.minOrderValue;
                                    return (
                                        <button
                                            key={promo.id}
                                            onClick={() => {
                                                setPromoCode(promo.code);
                                                setShowPromoList(false);
                                                // applyPromo is handled by caller when input changes or on click
                                            }}
                                            disabled={!isEligible}
                                            className={`w-full text-left p-3 rounded-lg border transition-all ${isEligible
                                                    ? 'border-gray-200 hover:border-[#4b2192] hover:bg-[#4b2192]/5 cursor-pointer'
                                                    : 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed'
                                                }`}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="inline-flex items-center gap-1 text-xs font-bold text-[#4b2192] bg-[#4b2192]/10 px-2 py-0.5 rounded border border-dashed border-[#4b2192]/30 tracking-wider">
                                                            {promo.code}
                                                        </span>
                                                    </div>
                                                    {promo.description && (
                                                        <p className="text-xs text-gray-500 mt-1 line-clamp-1">{promo.description}</p>
                                                    )}
                                                    {promo.minOrderValue > 0 && (
                                                        <p className={`text-[10px] mt-1 ${isEligible ? 'text-gray-400' : 'text-orange-500 font-medium'}`}>
                                                            {isEligible ? `Min. order ₹${promo.minOrderValue}` : `Add ₹${promo.minOrderValue - cartTotal} more to unlock`}
                                                        </p>
                                                    )}
                                                </div>
                                                <div className="shrink-0 text-right">
                                                    <span className="inline-block text-xs font-bold text-green-700 bg-green-50 px-2 py-1 rounded">
                                                        {promo.discountType === 'PERCENTAGE'
                                                            ? `${promo.discountValue}% OFF`
                                                            : `FLAT ₹${promo.discountValue}`}
                                                    </span>
                                                    {promo.discountType === 'PERCENTAGE' && promo.maxDiscount && (
                                                        <p className="text-[10px] text-gray-400 mt-0.5">up to ₹{promo.maxDiscount}</p>
                                                    )}
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    )}
                </div>
            ) : (
                <div className="p-3 bg-green-50 border border-green-100 rounded-lg flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center">
                            <Check className="w-3.5 h-3.5 text-green-600" />
                        </div>
                        <div>
                            <p className="text-sm font-bold text-green-700">{appliedPromo.code} Applied</p>
                            <p className="text-xs text-green-600">You saved ₹{appliedPromo.discountAmount}</p>
                        </div>
                    </div>
                    <button onClick={removePromo} className="text-gray-400 hover:text-red-500 transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}

            {walletBalance > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                    <label className="flex items-center gap-3 cursor-pointer select-none">
                        <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${useWallet ? 'bg-[#4b2192] border-[#4b2192]' : 'border-gray-300 bg-white'}`}>
                            {useWallet && <Check className="w-3.5 h-3.5 text-white" />}
                        </div>
                        <input
                            type="checkbox"
                            checked={useWallet}
                            onChange={(e) => setUseWallet(e.target.checked)}
                            className="hidden"
                        />
                        <div className="flex-1">
                            <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                <Wallet className="w-4 h-4 text-gray-500" /> Use Wallet Balance
                            </p>
                            <p className="text-xs text-gray-500">Available: ₹{walletBalance}</p>
                        </div>
                    </label>
                </div>
            )}
        </div>
    );
}
