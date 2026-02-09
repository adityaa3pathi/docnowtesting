
import { useState, useEffect } from 'react';
import { Loader2, AlertCircle, CheckCircle2, Phone } from 'lucide-react';
import api from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui';
import { STATUS_MAP } from './types';

interface TrackStatusDialogProps {
    bookingId: string | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onStatusUpdate?: () => void;
}

export function TrackStatusDialog({ bookingId, open, onOpenChange, onStatusUpdate }: TrackStatusDialogProps) {
    const [statusLoading, setStatusLoading] = useState(false);
    const [statusData, setStatusData] = useState<any>(null);
    const [phleboLoading, setPhleboLoading] = useState(false);
    const [phleboData, setPhleboData] = useState<any>(null);

    useEffect(() => {
        if (open && bookingId) {
            fetchStatus(bookingId);
            // Reset phlebo data on new booking
            setPhleboData(null);
        }
    }, [open, bookingId]);

    const fetchStatus = async (id: string) => {
        setStatusLoading(true);
        setStatusData(null);
        try {
            const res = await api.get(`/bookings/${id}/status`);
            setStatusData(res.data);
            if (onStatusUpdate) onStatusUpdate();

            // If status is BS005, we might want to auto-fetch phlebo or check if available?
            // Original code didn't auto-fetch.
        } catch (error: any) {
            console.error('Error tracking status:', error);
            setStatusData({ error: error.response?.data?.error || 'Failed to fetch real-time status.' });
        } finally {
            setStatusLoading(false);
        }
    };

    const handleFetchPhlebo = async () => {
        if (!bookingId) return;
        setPhleboLoading(true);
        try {
            const res = await api.get(`/bookings/${bookingId}/phlebo-contact`);
            setPhleboData(res.data);
        } catch (error: any) {
            console.error('Error fetching phlebo contact:', error);
            // alert(error.response?.data?.error || 'Phlebotomist contact not available yet.');
        } finally {
            setPhleboLoading(false);
        }
    };

    const getStatusInfo = (code: string) => {
        return STATUS_MAP[code] || { label: code, color: 'bg-gray-100 text-gray-700', step: 1 };
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle>Live Status Tracking</DialogTitle>
                </DialogHeader>

                <div className="mt-4">
                    {statusLoading ? (
                        <div className="flex flex-col items-center justify-center py-12">
                            <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
                            <p className="text-gray-500">Fetching latest status from Healthians...</p>
                        </div>
                    ) : statusData ? (
                        <div className="space-y-6">
                            {statusData.error ? (
                                <div className="p-4 bg-red-50 text-red-600 rounded-lg flex items-center gap-3">
                                    <AlertCircle className="w-5 h-5" />
                                    {statusData.error}
                                </div>
                            ) : (
                                <>
                                    {/* Status Header */}
                                    <div className="bg-slate-50 p-6 rounded-xl border border-slate-100">
                                        <div className="flex justify-between items-start mb-6">
                                            <div>
                                                <div className="text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Current Status</div>
                                                <div className={`inline-block px-3 py-1 rounded-full text-sm font-bold ${getStatusInfo(statusData.data?.booking_status).color}`}>
                                                    {getStatusInfo(statusData.data?.booking_status).label}
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Booking ID</div>
                                                <div className="font-mono font-bold text-slate-900">{statusData.data?.booking_id}</div>
                                            </div>
                                        </div>

                                        {/* Minimal Stepper */}
                                        <div className="relative flex justify-between">
                                            <div className="absolute top-4 left-0 w-full h-0.5 bg-slate-200 -z-10" />
                                            <div
                                                className="absolute top-4 left-0 h-0.5 bg-primary transition-all duration-500 -z-10"
                                                style={{ width: `${Math.max(0, (getStatusInfo(statusData.data?.booking_status).step - 1) * 25)}%` }}
                                            />
                                            {[1, 2, 3, 4, 5].map((s) => (
                                                <div key={s} className={`w-8 h-8 rounded-full flex items-center justify-center border-2 bg-white transition-colors ${s <= getStatusInfo(statusData.data?.booking_status).step ? 'border-primary text-primary' : 'border-slate-200 text-slate-300'
                                                    }`}>
                                                    {s < getStatusInfo(statusData.data?.booking_status).step ? <CheckCircle2 className="w-5 h-5" /> : <span className="text-xs font-bold">{s}</span>}
                                                </div>
                                            ))}
                                        </div>
                                        <div className="flex justify-between mt-2 px-1">
                                            <span className="text-[10px] font-bold text-slate-400 uppercase">Booked</span>
                                            <span className="text-[10px] font-bold text-slate-400 uppercase">Scheduled</span>
                                            <span className="text-[10px] font-bold text-slate-400 uppercase">Assigned</span>
                                            <span className="text-[10px] font-bold text-slate-400 uppercase">Collected</span>
                                            <span className="text-[10px] font-bold text-slate-400 uppercase">Report</span>
                                        </div>
                                    </div>

                                    {/* Phlebotomist Contact (if assigned) */}
                                    {statusData.data?.booking_status === 'BS005' && (
                                        <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex items-center justify-between gap-4">
                                            <div className="flex items-center gap-3">
                                                <div className="bg-blue-600 p-2 rounded-full text-white">
                                                    <Phone className="w-4 h-4" />
                                                </div>
                                                <div>
                                                    <div className="text-[10px] text-blue-500 uppercase font-bold tracking-wider">Assigned Phlebotomist</div>
                                                    <div className="text-sm font-bold text-blue-900">
                                                        {phleboData?.phlebo_name || 'Collector Assigned'}
                                                    </div>
                                                </div>
                                            </div>
                                            <div>
                                                {phleboData ? (
                                                    <a
                                                        href={`tel:${phleboData.masked_number}`}
                                                        className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 transition-colors"
                                                    >
                                                        <Phone className="w-4 h-4" />
                                                        {phleboData.masked_number}
                                                    </a>
                                                ) : (
                                                    <Button
                                                        variant="outline"
                                                        onClick={handleFetchPhlebo}
                                                        disabled={phleboLoading}
                                                        className="gap-2 bg-blue-100 text-blue-700 hover:bg-blue-200 border-none text-xs font-bold"
                                                    >
                                                        {phleboLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Phone className="w-3 h-3" />}
                                                        Get Contact Number
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* Patient Details */}
                                    <div className="space-y-4">
                                        <h4 className="text-sm font-bold text-slate-900 uppercase tracking-tight">Orders by Patient</h4>
                                        {statusData.data?.customer?.map((cust: any, idx: number) => (
                                            <div key={idx} className="border border-slate-100 rounded-xl overflow-hidden">
                                                <div className="bg-slate-50 px-4 py-2 flex justify-between items-center border-b border-slate-100">
                                                    <span className="text-xs font-bold text-slate-600">
                                                        {statusData.patientDetails?.[cust.vendor_customer_id]
                                                            ? `${statusData.patientDetails[cust.vendor_customer_id].name} (${statusData.patientDetails[cust.vendor_customer_id].relation})`
                                                            : `Patient #${idx + 1}`}
                                                    </span>
                                                    <div className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${getStatusInfo(cust.customer_status).color}`}>
                                                        {getStatusInfo(cust.customer_status).label}
                                                    </div>
                                                </div>
                                                <div className="p-4 space-y-3">
                                                    {cust.test_list?.map((test: any, tIdx: number) => (
                                                        <div key={tIdx} className="flex justify-between items-center text-sm">
                                                            <span className="text-slate-700 font-medium">{test.test_name}</span>
                                                            <span className={`text-xs font-bold ${getStatusInfo(test.test_status).color.split(' ')[1]}`}>
                                                                {getStatusInfo(test.test_status).label}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    ) : null}
                </div>
            </DialogContent>
        </Dialog>
    );
}
