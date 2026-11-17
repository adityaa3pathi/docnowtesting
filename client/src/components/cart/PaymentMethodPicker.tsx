'use client';
import { Banknote, CreditCard } from 'lucide-react';

export type CheckoutPaymentMethod = 'ONLINE' | 'PAY_ON_COLLECTION';

const OPTIONS: { value: CheckoutPaymentMethod; title: string; text: string; icon: typeof CreditCard }[] = [
    { value: 'ONLINE', title: 'Pay online now', text: 'UPI, cards or net banking', icon: CreditCard },
    { value: 'PAY_ON_COLLECTION', title: 'Pay at sample collection', text: 'Cash or UPI to the sample collector at your visit', icon: Banknote },
];

/** Shown only when the server offers pay on collection; otherwise checkout stays online-only. */
export function PaymentMethodPicker({ value, onChange }: { value: CheckoutPaymentMethod; onChange: (m: CheckoutPaymentMethod) => void }) {
    return (
        <fieldset className="mb-6">
            <legend className="mb-2 text-sm font-semibold text-gray-900">How would you like to pay?</legend>
            <div className="space-y-2">
                {OPTIONS.map(({ value: v, title, text, icon: Icon }) => (
                    <label
                        key={v}
                        className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${value === v ? 'border-primary bg-primary/5' : 'border-gray-200 hover:bg-gray-50'}`}
                    >
                        <input type="radio" name="payment-method" value={v} checked={value === v} onChange={() => onChange(v)} className="mt-1 h-4 w-4 accent-[#4b2192]" />
                        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                        <span>
                            <span className="block text-sm font-semibold text-gray-900">{title}</span>
                            <span className="block text-sm text-gray-600">{text}</span>
                        </span>
                    </label>
                ))}
            </div>
        </fieldset>
    );
}
