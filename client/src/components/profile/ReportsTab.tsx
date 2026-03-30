"use client";

import { useState, useEffect } from "react";
import { FileText, Download, Clock, AlertCircle, CheckCircle2 } from "lucide-react";
import api from "@/lib/api";

interface ReportItem {
    id: string;
    isFullReport: boolean;
    fetchStatus: string;
    verifiedAt: string | null;
    fileSize: number | null;
    generatedAt: string;
}

interface BookingWithReports {
    id: string;
    partnerBookingId: string | null;
    status: string;
    slotDate: string;
    totalAmount: number;
    createdAt: string;
    items: string[];
    reports: ReportItem[];
}

export function ReportsTab() {
    const [bookings, setBookings] = useState<BookingWithReports[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchBookingsWithReports();
    }, []);

    const fetchBookingsWithReports = async () => {
        try {
            const res = await api.get("/bookings");
            // Filter to only bookings that have reports
            const withReports = (res.data || []).filter(
                (b: BookingWithReports) => b.reports && b.reports.length > 0
            );
            setBookings(withReports);
        } catch (err: any) {
            if (!err?.isNetworkError) {
                console.error("Error fetching reports:", err);
            }
        } finally {
            setLoading(false);
        }
    };

    const getDownloadUrl = (reportId: string) => {
        return `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api"}/reports/${reportId}/download`;
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
        });
    };

    const formatFileSize = (bytes: number | null) => {
        if (!bytes) return "";
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    if (loading) {
        return (
            <div>
                <h2 className="text-xl font-bold mb-6">Lab Reports</h2>
                <div className="space-y-4">
                    {[1, 2].map((i) => (
                        <div
                            key={i}
                            className="bg-gray-50 rounded-xl p-6 animate-pulse"
                        >
                            <div className="h-4 bg-gray-200 rounded w-1/3 mb-3"></div>
                            <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (bookings.length === 0) {
        return (
            <div>
                <h2 className="text-xl font-bold mb-6">Lab Reports</h2>
                <div className="text-center py-16">
                    <FileText
                        size={48}
                        className="mx-auto text-gray-300 mb-4"
                    />
                    <p className="text-gray-500 text-lg mb-1">
                        No reports available yet
                    </p>
                    <p className="text-gray-400 text-sm">
                        Reports will appear here once your lab tests are
                        processed.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div>
            <h2 className="text-xl font-bold mb-6">Lab Reports</h2>
            <div className="space-y-5">
                {bookings.map((booking) => (
                    <div
                        key={booking.id}
                        className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden"
                    >
                        {/* Booking Header */}
                        <div className="px-5 py-4 bg-gray-50/80 border-b border-gray-100">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-semibold text-gray-900">
                                        {booking.items.join(", ")}
                                    </p>
                                    <p className="text-xs text-gray-500 mt-0.5">
                                        {formatDate(booking.slotDate)} •{" "}
                                        ₹{booking.totalAmount.toLocaleString("en-IN")}
                                    </p>
                                </div>
                                <span className="text-xs font-mono text-gray-400">
                                    {booking.partnerBookingId || booking.id.slice(0, 8)}
                                </span>
                            </div>
                        </div>

                        {/* Reports List */}
                        <div className="px-5 py-4 space-y-3">
                            {booking.reports.map((report, idx) => (
                                <div
                                    key={report.id}
                                    className="flex items-center justify-between gap-4 p-3 rounded-lg bg-gray-50/50 hover:bg-gray-50 transition-colors"
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div
                                            className={`p-2 rounded-lg ${
                                                report.fetchStatus === "STORED"
                                                    ? "bg-green-100 text-green-700"
                                                    : report.fetchStatus === "FAILED"
                                                    ? "bg-red-100 text-red-700"
                                                    : "bg-amber-100 text-amber-700"
                                            }`}
                                        >
                                            {report.fetchStatus === "STORED" ? (
                                                <CheckCircle2 size={18} />
                                            ) : report.fetchStatus === "FAILED" ? (
                                                <AlertCircle size={18} />
                                            ) : (
                                                <Clock size={18} />
                                            )}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium text-gray-900">
                                                {report.isFullReport
                                                    ? "Full Report"
                                                    : `Partial Report ${idx + 1}`}
                                            </p>
                                            <p className="text-xs text-gray-500">
                                                {report.verifiedAt
                                                    ? `Verified ${formatDate(report.verifiedAt)}`
                                                    : `Generated ${formatDate(report.generatedAt)}`}
                                                {report.fileSize
                                                    ? ` • ${formatFileSize(report.fileSize)}`
                                                    : ""}
                                            </p>
                                        </div>
                                    </div>

                                    {report.fetchStatus === "STORED" ? (
                                        <a
                                            href={getDownloadUrl(report.id)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-2 px-4 py-2 bg-[#241769] hover:bg-[#1a1050] text-white text-sm font-medium rounded-lg transition-colors shrink-0"
                                        >
                                            <Download size={16} />
                                            Download
                                        </a>
                                    ) : report.fetchStatus === "PENDING" ? (
                                        <span className="text-xs text-amber-600 font-medium px-3 py-1.5 bg-amber-50 rounded-lg">
                                            Processing...
                                        </span>
                                    ) : (
                                        <a
                                            href={getDownloadUrl(report.id)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors shrink-0"
                                        >
                                            <Download size={16} />
                                            Retry
                                        </a>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
