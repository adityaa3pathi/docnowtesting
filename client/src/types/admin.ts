export interface AdminUser {
    id: string;
    name: string | null;
    email: string | null;
    mobile: string;
    role: 'USER' | 'MANAGER' | 'SUPER_ADMIN';
    status: 'ACTIVE' | 'BLOCKED';
    referralCode: string | null;
    totalOrders: number;
    walletBalance: number;
    createdAt: string;
}

export interface AdminPagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

export type StatusFilter = 'All' | 'ACTIVE' | 'BLOCKED';
export type RoleFilter = 'All' | 'USER' | 'MANAGER';

// ─── User Detail Types ───

export interface UserDetails {
    id: string;
    name: string | null;
    email: string | null;
    mobile: string;
    role: string;
    status: 'ACTIVE' | 'BLOCKED';
    referralCode: string | null;
    createdAt: string;
}

export interface DetailPatient {
    id: string;
    name: string;
    relation: string;
    age: number;
    gender: string;
}

export interface BookingItem {
    id: string;
    testCode: string;
    testName: string;
    price: number;
    status: string | null;
    patient: DetailPatient;
}

export interface BookingReport {
    id: string;
    reportUrl: string;
    generatedAt: string;
}

export interface OrderAddress {
    id: string;
    line1: string;
    city: string;
    pincode: string;
}

export interface Order {
    id: string;
    status: string;
    totalAmount: number;
    finalAmount: number;
    discountAmount: number;
    walletAmount: number;
    paymentStatus: string;
    slotDate: string | null;
    slotTime: string | null;
    createdAt: string;
    partnerBookingId: string | null;
    items: BookingItem[];
    reports: BookingReport[];
    address: OrderAddress | null;
    billingName: string | null;
}

export interface WalletLedgerEntry {
    id: string;
    type: string;
    amount: number;
    balanceAfter: number;
    description: string;
    referenceType: string | null;
    referenceId: string | null;
    createdAt: string;
}

export interface ReferralInfo {
    referredBy: { id: string; name: string | null; mobile: string } | null;
    referredCount: number;
}

export interface UserData {
    user: UserDetails;
    wallet: { balance: number };
    walletLedger: WalletLedgerEntry[];
    orders: Order[];
    referralInfo: ReferralInfo;
}
