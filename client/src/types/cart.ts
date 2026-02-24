export interface Patient {
    id: string;
    name: string;
    relation: string;
}

export interface Address {
    id: string;
    line1: string;
    city: string;
    pincode: string;
    lat?: string;
    long?: string;
}

export interface AppliedPromo {
    code: string;
    discountAmount: number;
    finalAmount: number;
    promoCodeId: string;
    description?: string;
    discountType: string;
    discountValue: number;
}

export interface AvailablePromo {
    id: string;
    code: string;
    description: string | null;
    discountType: 'PERCENTAGE' | 'FLAT';
    discountValue: number;
    maxDiscount: number | null;
    minOrderValue: number;
    expiresAt: string | null;
}

export interface SlotItem {
    slot_time: string;
    stm_id: string;
    [key: string]: unknown;
}
