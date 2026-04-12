
import { useState } from 'react';
import { MapPin, Loader2, Phone, Download, Clock } from 'lucide-react';
import { Button } from '@/components/ui';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { downloadAuthenticatedFile, getApiUrl } from '@/lib/api';
import { BookingHeader, PhleboDetails, getBookingJourneyBanner, getReportAction, getStatusDisplay } from './types';

interface BookingCardProps {
    booking: BookingHeader;
    onTrack: (id: string) => void;
    onReschedule: (booking: BookingHeader) => void;
    onCancel: (id: string) => void;
}

export function BookingCard({ booking, onTrack, onReschedule, onCancel }: BookingCardProps) {
    const [phleboLoading, setPhleboLoading] = useState(false);
    const [phleboData, setPhleboData] = useState<PhleboDetails | null>(null);
    const [reportDownloading, setReportDownloading] = useState(false);
    const [invoiceDownloading, setInvoiceDownloading] = useState(false);
    const statusInfo = getStatusDisplay(booking.status, booking.reports, booking.partnerStatus);
    const journeyBanner = getBookingJourneyBanner(booking, statusInfo);
    const reportAction = getReportAction(booking.reports);
    const reportUrl = reportAction.kind === 'download' || reportAction.kind === 'retry'
        ? getApiUrl(`/reports/${reportAction.report.id}/download`)
        : null;
    const invoiceUrl = booking.invoiceAvailable
        ? getApiUrl(`/invoices/booking/${booking.id}/download`)
        : null;
    const isAwaitingPayment = booking.paymentStatus === 'INITIATED' || statusInfo.label === 'Awaiting Payment';
    const activePartnerBookingId = booking.currentPartnerBookingId || booking.rescheduledToId || booking.partnerBookingId;
    const canTrack = !isAwaitingPayment && !!activePartnerBookingId && !['Superseded', 'Refunded', 'Cancelled'].includes(statusInfo.label);
    const canReschedule = ['Order Booked', 'Sample Collector Assigned', 'Fresh Sample Needed', 'Rescheduled'].includes(statusInfo.label);
    const canCancel = !['Cancelled', 'Sample Collected', 'Sample Received at Lab', 'Report Ready', 'Completed', 'Superseded', 'Refunded'].includes(statusInfo.label);

    const handleFetchPhlebo = async () => {
        setPhleboLoading(true);
        try {
            const res = await api.get(`/bookings/${booking.id}/phlebo-contact`);
            setPhleboData(res.data);
        } catch (error: any) {
            console.error('Error fetching phlebo contact:', error);
            toast.error(error.response?.data?.error || 'Phlebotomist contact not available yet.');
        } finally {
            setPhleboLoading(false);
        }
    };

    const handleDownloadReport = async () => {
        if (!reportUrl) return;
        setReportDownloading(true);
        try {
            await downloadAuthenticatedFile(reportUrl, `report-${activePartnerBookingId || booking.id}.pdf`);
        } catch (error: any) {
            console.error('Error downloading report:', error);
            toast.error(error.message || 'Failed to download report');
        } finally {
            setReportDownloading(false);
        }
    };

    const handleDownloadInvoice = async () => {
        if (!invoiceUrl) return;
        setInvoiceDownloading(true);
        try {
            await downloadAuthenticatedFile(invoiceUrl, `invoice-${booking.id}.pdf`);
        } catch (error: any) {
            console.error('Error downloading invoice:', error);
            toast.error(error.message || 'Failed to download invoice');
        } finally {
            setInvoiceDownloading(false);
        }
    };

    return (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
            {/* Header */}
            <div className="bg-gray-50 px-4 sm:px-6 py-4 grid grid-cols-2 sm:flex sm:flex-wrap sm:justify-between sm:items-center gap-3 sm:gap-4 border-b border-gray-100">
                <div>
                    <div className="text-xs sm:text-sm text-gray-500">Booking ID</div>
                    <div className="font-mono font-medium text-slate-800 text-sm">
                        {activePartnerBookingId || booking.id.slice(0, 8)}
                    </div>
                    {booking.trackingReferenceUpdated && booking.previousPartnerBookingIds?.length ? (
                        <div className="mt-1 text-xs text-slate-500">
                            Previous reference: {booking.previousPartnerBookingIds[0]}
                        </div>
                    ) : null}
                </div>
                <div>
                    <div className="text-xs sm:text-sm text-gray-500">Scheduled For</div>
                    <div className="font-medium text-slate-800 text-sm">
                        {new Date(booking.slotDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        {booking.slotTime && !/^\d+$/.test(booking.slotTime) && (
                            <span className="text-gray-500 font-normal"> at {booking.slotTime}</span>
                        )}
                    </div>
                </div>
                <div>
                    <div className="text-xs sm:text-sm text-gray-500">Total Amount</div>
                    <div className="font-bold text-primary">₹{booking.totalAmount}</div>
                </div>
                <div className={`px-3 py-1 rounded-full text-[10px] sm:text-xs font-bold uppercase tracking-widest w-fit ${statusInfo.color}`}>
                    {statusInfo.label}
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

                <div className="mb-6 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                    <p className="text-sm text-slate-700">{statusInfo.message}</p>
                    {statusInfo.subMessage && (
                        <p className="mt-1 text-sm text-slate-500">{statusInfo.subMessage}</p>
                    )}
                </div>

                {journeyBanner && (
                    <div className={`mb-6 rounded-lg border px-4 py-3 ${
                        journeyBanner.tone === 'warning'
                            ? 'border-amber-200 bg-amber-50'
                            : journeyBanner.tone === 'success'
                                ? 'border-green-200 bg-green-50'
                                : 'border-blue-200 bg-blue-50'
                    }`}>
                        <p className={`text-sm font-semibold ${
                            journeyBanner.tone === 'warning'
                                ? 'text-amber-800'
                                : journeyBanner.tone === 'success'
                                    ? 'text-green-800'
                                    : 'text-blue-800'
                        }`}>
                            {journeyBanner.title}
                        </p>
                        <p className={`mt-1 text-sm ${
                            journeyBanner.tone === 'warning'
                                ? 'text-amber-700'
                                : journeyBanner.tone === 'success'
                                    ? 'text-green-700'
                                    : 'text-blue-700'
                        }`}>
                            {journeyBanner.description}
                        </p>
                    </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap gap-2 sm:gap-3 pt-4 border-t border-gray-100">
                    <Button
                        onClick={() => onTrack(booking.id)}
                        variant="primary"
                        disabled={!canTrack}
                        className="gap-2 text-xs sm:text-sm"
                    >
                        <MapPin className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        Track
                    </Button>

                    <Button
                        variant="outline"
                        onClick={() => onReschedule(booking)}
                        disabled={!canReschedule}
                        className="text-xs sm:text-sm"
                    >
                        Reschedule
                    </Button>

                    <Button
                        variant="outline"
                        onClick={() => onCancel(booking.id)}
                        disabled={!canCancel}
                        className="text-red-500 hover:text-red-600 hover:bg-red-50 text-xs sm:text-sm"
                    >
                        Cancel
                    </Button>

                    {reportUrl && (
                        <button
                            type="button"
                            onClick={handleDownloadReport}
                            disabled={reportDownloading}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-2 text-xs font-bold text-green-700 transition-colors hover:bg-green-100 sm:text-sm"
                        >
                            <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                            {reportDownloading
                                ? 'Downloading...'
                                : reportAction.kind === 'retry'
                                    ? 'Retry Report Download'
                                    : 'Download Report'}
                        </button>
                    )}

                    {reportAction.kind === 'processing' && (
                        <div className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-50 px-4 py-2 text-xs font-bold text-amber-700 sm:text-sm">
                            <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                            Report is being prepared
                        </div>
                    )}

                    {invoiceUrl && (
                        <button
                            type="button"
                            onClick={handleDownloadInvoice}
                            disabled={invoiceDownloading}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-100 sm:text-sm"
                        >
                            <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                            {invoiceDownloading ? 'Downloading Invoice...' : 'Download Invoice'}
                        </button>
                    )}

                    {/* Phlebo Contact Action */}
                    {statusInfo.label === 'Sample Collector Assigned' && (
                        <div className="w-full sm:flex-1 sm:flex sm:justify-end mt-1 sm:mt-0">
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
