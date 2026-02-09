
import { useState } from 'react';
import { MapPin, Loader2, Phone } from 'lucide-react';
import { Button } from '@/components/ui';
import api from '@/lib/api';
import { BookingHeader, PhleboDetails } from './types';

interface BookingCardProps {
    booking: BookingHeader;
    onTrack: (id: string) => void;
    onReschedule: (booking: BookingHeader) => void;
    onCancel: (id: string) => void;
}

export function BookingCard({ booking, onTrack, onReschedule, onCancel }: BookingCardProps) {
    const [phleboLoading, setPhleboLoading] = useState(false);
    const [phleboData, setPhleboData] = useState<PhleboDetails | null>(null);

    const handleFetchPhlebo = async () => {
        setPhleboLoading(true);
        try {
            const res = await api.get(`/bookings/${booking.id}/phlebo-contact`);
            setPhleboData(res.data);
        } catch (error: any) {
            console.error('Error fetching phlebo contact:', error);
            // alert(error.response?.data?.error || 'Phlebotomist contact not available yet.');
        } finally {
            setPhleboLoading(false);
        }
    };

    return (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
            {/* Header */}
            <div className="bg-gray-50 px-6 py-4 flex flex-wrap justify-between items-center gap-4 border-b border-gray-100">
                <div>
                    <div className="text-sm text-gray-500">Booking ID</div>
                    <div className="font-mono font-medium text-slate-800">
                        {booking.partnerBookingId || booking.id.slice(0, 8)}
                    </div>
                </div>
                <div>
                    <div className="text-sm text-gray-500">Scheduled For</div>
                    <div className="font-medium text-slate-800">
                        {new Date(booking.slotDate).toLocaleDateString()} at {booking.slotTime}
                    </div>
                </div>
                <div>
                    <div className="text-sm text-gray-500">Total Amount</div>
                    <div className="font-bold text-primary">₹{booking.totalAmount}</div>
                </div>
                <div className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${booking.status === 'Order Booked' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                    {booking.status}
                </div>
            </div>

            {/* Body */}
            <div className="p-6">
                <h4 className="text-sm font-semibold text-gray-500 mb-3 uppercase tracking-wider">Packages & Tests</h4>
                <ul className="space-y-2 mb-6">
                    {booking.items.map((item, idx) => (
                        <li key={idx} className="flex items-center gap-2 text-gray-700">
                            <div className="w-1.5 h-1.5 bg-primary rounded-full" />
                            {item}
                        </li>
                    ))}
                </ul>

                {/* Actions */}
                <div className="flex flex-wrap gap-3 pt-4 border-t border-gray-100">
                    <Button
                        onClick={() => onTrack(booking.id)}
                        variant="primary"
                        disabled={booking.status === 'Rescheduled'}
                        className="gap-2"
                    >
                        <MapPin className="w-4 h-4" />
                        Track Status
                    </Button>

                    <Button
                        variant="outline"
                        onClick={() => onReschedule(booking)}
                        disabled={!['Order Booked', 'Sample Collector Assigned'].includes(booking.status)}
                    >
                        Reschedule
                    </Button>

                    <Button
                        variant="outline"
                        onClick={() => onCancel(booking.id)}
                        disabled={booking.status === 'Cancelled' || booking.status === 'Rescheduled'}
                        className="text-red-500 hover:text-red-600 hover:bg-red-50"
                    >
                        Cancel Booking
                    </Button>

                    {/* Phlebo Contact Action */}
                    {booking.status === 'Sample Collector Assigned' && (
                        <div className="flex-1 flex justify-end">
                            {phleboData ? (
                                <div className="bg-blue-50 p-2 px-4 rounded-lg border border-blue-100 flex items-center gap-4">
                                    <div>
                                        <div className="text-[10px] text-blue-500 uppercase font-bold">Assigned Phlebo</div>
                                        <div className="text-sm font-bold text-blue-900">{phleboData.phlebo_name}</div>
                                    </div>
                                    <a
                                        href={`tel:${phleboData.masked_number}`}
                                        className="bg-blue-600 text-white p-2 rounded-full hover:bg-blue-700 transition-colors"
                                        title={`Call ${phleboData.phlebo_name}`}
                                    >
                                        <Phone className="w-4 h-4" />
                                    </a>
                                </div>
                            ) : (
                                <Button
                                    variant="outline"
                                    onClick={handleFetchPhlebo}
                                    disabled={phleboLoading}
                                    className="gap-2 bg-blue-100 text-blue-700 hover:bg-blue-200 border-none"
                                >
                                    {phleboLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
                                    Contact Phlebotomist
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
