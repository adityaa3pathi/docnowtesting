import { useEffect, useState } from 'react';
import { Building2, CheckCircle, ChevronLeft, ChevronRight, Download, Loader2, RefreshCw, Search } from 'lucide-react';
import { useCorporateInquiries, CorporateInquiry, CorporateInquiryStatus } from '@/hooks/useCorporateInquiries';
import { useExport } from '@/hooks/useExport';

interface CorporateInquiriesViewProps {
    apiPrefix: '/api/admin' | '/api/manager';
    title?: string;
    subtitle?: string;
}

const STATUS_OPTIONS: Array<'All' | CorporateInquiryStatus> = ['All', 'NEW', 'CONTACTED', 'QUALIFIED', 'CLOSED'];
const REQUIREMENT_OPTIONS = ['All', 'Employee health checkups', 'Onsite health camps', 'Pre-employment testing', 'Recurring diagnostics partnership', 'Custom requirement'];
const COMPANY_SIZE_OPTIONS = ['All', '1-50', '51-200', '201-1000', '1000+'];

const STATUS_STYLES: Record<CorporateInquiryStatus, string> = {
    NEW: 'bg-blue-100 text-blue-800',
    CONTACTED: 'bg-amber-100 text-amber-800',
    QUALIFIED: 'bg-purple-100 text-purple-800',
    CLOSED: 'bg-slate-100 text-slate-700',
};

export function CorporateInquiriesView({
    apiPrefix,
    title = 'Corporate Inquiries',
    subtitle = 'Review and qualify incoming B2B testing leads',
}: CorporateInquiriesViewProps) {
    const { inquiries, pagination, loading, actionLoading, fetchInquiries, updateStatus } = useCorporateInquiries(apiPrefix);
    const { exporting, exportCsv } = useExport();

    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<'All' | CorporateInquiryStatus>('All');
    const [cityFilter, setCityFilter] = useState('');
    const [requirementFilter, setRequirementFilter] = useState('All');
    const [companySizeFilter, setCompanySizeFilter] = useState('All');
    const [createdDateFilter, setCreatedDateFilter] = useState('');
    const [page, setPage] = useState(1);

    const [selectedInquiry, setSelectedInquiry] = useState<CorporateInquiry | null>(null);
    const [notes, setNotes] = useState('');
    const [nextStatus, setNextStatus] = useState<CorporateInquiryStatus>('CONTACTED');

    useEffect(() => {
        fetchInquiries({
            page,
            search: searchTerm,
            status: statusFilter,
            city: cityFilter,
            requirementType: requirementFilter,
            companySize: companySizeFilter,
            createdDate: createdDateFilter,
        });
    }, [page, statusFilter, cityFilter, requirementFilter, companySizeFilter, createdDateFilter, fetchInquiries]);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (page !== 1) setPage(1);
            else {
                fetchInquiries({
                    page: 1,
                    search: searchTerm,
                    status: statusFilter,
                    city: cityFilter,
                    requirementType: requirementFilter,
                    companySize: companySizeFilter,
                    createdDate: createdDateFilter,
                });
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [searchTerm, page, statusFilter, cityFilter, requirementFilter, companySizeFilter, createdDateFilter, fetchInquiries]);

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    };

    const handleUpdateSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedInquiry) return;

        const success = await updateStatus(selectedInquiry.id, nextStatus, notes);
        if (success) {
            setSelectedInquiry(null);
            setNotes('');
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-semibold text-gray-900">{title}</h1>
                    <p className="text-gray-600 mt-1">{subtitle}</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => exportCsv('corporate-inquiries', {
                            search: searchTerm,
                            status: statusFilter,
                            city: cityFilter,
                            requirementType: requirementFilter,
                            companySize: companySizeFilter,
                            createdDate: createdDateFilter,
                        }, apiPrefix)}
                        disabled={exporting}
                        className="flex items-center gap-2 px-4 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                    >
                        {exporting ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
                        Export CSV
                    </button>
                    <button
                        onClick={() => fetchInquiries({ page, search: searchTerm, status: statusFilter, city: cityFilter, requirementType: requirementFilter, companySize: companySizeFilter, createdDate: createdDateFilter })}
                        className="flex items-center gap-2 px-4 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                        Refresh
                    </button>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                <div className="flex flex-col xl:flex-row gap-4">
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                        <input
                            type="text"
                            placeholder="Search by company, contact, email, mobile, or city..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4b2192] focus:border-transparent"
                        />
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <input
                            type="text"
                            value={cityFilter}
                            onChange={(e) => { setCityFilter(e.target.value); setPage(1); }}
                            placeholder="Filter by city"
                            className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm"
                        />
                        <input
                            type="date"
                            value={createdDateFilter}
                            onChange={(e) => { setCreatedDateFilter(e.target.value); setPage(1); }}
                            className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm"
                        />
                        <select
                            value={statusFilter}
                            onChange={(e) => { setStatusFilter(e.target.value as 'All' | CorporateInquiryStatus); setPage(1); }}
                            className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm"
                        >
                            {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
                        </select>
                        <select
                            value={requirementFilter}
                            onChange={(e) => { setRequirementFilter(e.target.value); setPage(1); }}
                            className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm"
                        >
                            {REQUIREMENT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                        <select
                            value={companySizeFilter}
                            onChange={(e) => { setCompanySizeFilter(e.target.value); setPage(1); }}
                            className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm"
                        >
                            {COMPANY_SIZE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                {loading && inquiries.length === 0 ? (
                    <div className="flex items-center justify-center h-64">
                        <Loader2 className="h-8 w-8 animate-spin text-[#4b2192]" />
                    </div>
                ) : inquiries.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                        <Building2 className="h-12 w-12 text-gray-300 mb-4" />
                        <p>No corporate inquiries found</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50 border-b border-gray-100">
                                <tr>
                                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Created At</th>
                                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Company</th>
                                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Contact</th>
                                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">City</th>
                                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Company Size</th>
                                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Requirement</th>
                                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                                    <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {inquiries.map((inquiry) => (
                                    <tr key={inquiry.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 text-sm text-gray-600">{formatDate(inquiry.createdAt)}</td>
                                        <td className="px-6 py-4">
                                            <p className="font-medium text-gray-900">{inquiry.companyName}</p>
                                            <p className="text-sm text-gray-500">{inquiry.requirementType}</p>
                                        </td>
                                        <td className="px-6 py-4">
                                            <p className="font-medium text-gray-900">{inquiry.contactName}</p>
                                            <p className="text-sm text-gray-500">{inquiry.workEmail}</p>
                                            <p className="text-sm text-gray-500">{inquiry.mobile}</p>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-600">{inquiry.city}</td>
                                        <td className="px-6 py-4 text-sm text-gray-600">{inquiry.companySize}</td>
                                        <td className="px-6 py-4 text-sm text-gray-600 max-w-[220px]">
                                            <p className="line-clamp-2">{inquiry.summary || 'No additional notes shared yet.'}</p>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[inquiry.status]}`}>
                                                {inquiry.status}
                                            </span>
                                            {inquiry.notes && (
                                                <p className="text-xs text-gray-400 mt-1 max-w-[200px] truncate" title={inquiry.notes}>
                                                    {inquiry.notes}
                                                </p>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <button
                                                onClick={() => {
                                                    setSelectedInquiry(inquiry);
                                                    setNotes(inquiry.notes || '');
                                                    setNextStatus(inquiry.status === 'NEW' ? 'CONTACTED' : inquiry.status === 'CONTACTED' ? 'QUALIFIED' : inquiry.status === 'QUALIFIED' ? 'CLOSED' : 'CLOSED');
                                                }}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[#4b2192] bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors"
                                            >
                                                <CheckCircle size={16} />
                                                Update
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {!loading && inquiries.length > 0 && (
                    <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
                        <p className="text-sm text-gray-500">
                            Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
                        </p>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setPage((p) => p - 1)}
                                disabled={pagination.page <= 1}
                                className="p-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50"
                            >
                                <ChevronLeft size={16} />
                            </button>
                            <button
                                onClick={() => setPage((p) => p + 1)}
                                disabled={pagination.page >= pagination.totalPages}
                                className="p-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50"
                            >
                                <ChevronRight size={16} />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {selectedInquiry && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden">
                        <div className="flex justify-between items-center p-6 border-b border-gray-100">
                            <h3 className="text-lg font-semibold text-gray-900">Update Corporate Inquiry</h3>
                            <button onClick={() => setSelectedInquiry(null)} className="text-gray-400 hover:text-gray-600">✕</button>
                        </div>
                        <form onSubmit={handleUpdateSubmit}>
                            <div className="p-6 space-y-4">
                                <div className="grid gap-4 sm:grid-cols-2 bg-gray-50 p-4 rounded-lg text-sm text-gray-700">
                                    <p><strong>Company:</strong> {selectedInquiry.companyName}</p>
                                    <p><strong>Contact:</strong> {selectedInquiry.contactName}</p>
                                    <p><strong>Email:</strong> {selectedInquiry.workEmail}</p>
                                    <p><strong>Mobile:</strong> {selectedInquiry.mobile}</p>
                                    <p><strong>City:</strong> {selectedInquiry.city}</p>
                                    <p><strong>Company Size:</strong> {selectedInquiry.companySize}</p>
                                    <p className="sm:col-span-2"><strong>Requirement:</strong> {selectedInquiry.requirementType}</p>
                                    <p className="sm:col-span-2"><strong>Summary:</strong> {selectedInquiry.summary || 'No additional details provided.'}</p>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                                    <select
                                        value={nextStatus}
                                        onChange={(e) => setNextStatus(e.target.value as CorporateInquiryStatus)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-[#4b2192] focus:border-[#4b2192]"
                                    >
                                        {STATUS_OPTIONS.filter((status) => status !== 'All').map((status) => (
                                            <option key={status} value={status}>{status}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Internal Notes</label>
                                    <textarea
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                        rows={4}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-[#4b2192] focus:border-[#4b2192] resize-none"
                                        placeholder="Add sales notes, follow-up details, or qualification context..."
                                    />
                                </div>
                            </div>
                            <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setSelectedInquiry(null)}
                                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={actionLoading === selectedInquiry.id}
                                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#4b2192] rounded-lg hover:bg-[#3b1a74] disabled:opacity-50"
                                >
                                    {actionLoading === selectedInquiry.id && <Loader2 size={16} className="animate-spin" />}
                                    Save Update
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
