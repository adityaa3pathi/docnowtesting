
export interface BookingHeader {
    id: string;
    partnerBookingId: string | null;
    status: string;
    slotDate: string;
    slotTime: string;
    totalAmount: number;
    createdAt: string;
    addressId?: string;
    rescheduledToId?: string | null;
    items: string[];
}

export const STATUS_MAP: Record<string, { label: string, color: string, step: number }> = {
    'BS002': { label: 'Order Booked', color: 'bg-blue-100 text-blue-700', step: 1 },
    'BS003': { label: 'Sample Collection Scheduled', color: 'bg-yellow-100 text-yellow-700', step: 2 },
    'BS005': { label: 'Sample Collector Assigned', color: 'bg-purple-100 text-purple-700', step: 3 },
    'BS006': { label: 'Sample Collected', color: 'bg-indigo-100 text-indigo-700', step: 4 },
    'BS007': { label: 'Report Generated', color: 'bg-green-100 text-green-700', step: 5 },
    'BS0018': { label: 'Cancelled', color: 'bg-red-100 text-red-700', step: 0 },
    'Rescheduled': { label: 'Superseded', color: 'bg-gray-100 text-gray-500', step: 0 },
};

export interface PhleboDetails {
    masked_number: string;
    phlebo_name: string;
}
