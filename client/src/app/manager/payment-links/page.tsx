'use client';

import { useState } from 'react';
import {
    Plus,
    Copy,
    MessageSquare,
    Mail,
    ExternalLink,
    X,
    AlertCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';

/**
 * Payment Links — UI Shell
 * Backend APIs for payment link creation are not yet implemented.
 * This page uses mock data to demonstrate the intended UI.
 */

interface PaymentLink {
    id: string;
    linkId: string;
    customer: string;
    familyMember?: string;
    amount: number;
    status: 'Paid' | 'Pending' | 'Expired';
    createdAt: string;
    link: string;
}

const mockPaymentLinks: PaymentLink[] = [
    { id: '1', linkId: 'PL-2024-001', customer: 'Rajesh Kumar', familyMember: 'Self', amount: 3200, status: 'Paid', createdAt: '2024-02-14', link: 'https://docnow.in/pay/PL-2024-001' },
    { id: '2', linkId: 'PL-2024-002', customer: 'Priya Sharma', amount: 1850, status: 'Pending', createdAt: '2024-02-14', link: 'https://docnow.in/pay/PL-2024-002' },
    { id: '3', linkId: 'PL-2024-003', customer: 'Amit Patel', familyMember: 'Father', amount: 4500, status: 'Paid', createdAt: '2024-02-13', link: 'https://docnow.in/pay/PL-2024-003' },
    { id: '4', linkId: 'PL-2024-004', customer: 'Sneha Reddy', amount: 2100, status: 'Expired', createdAt: '2024-02-10', link: 'https://docnow.in/pay/PL-2024-004' },
];

const mockProducts = [
    { id: '1', name: 'Complete Blood Count (CBC)', price: 450 },
    { id: '2', name: 'Full Body Checkup Package', price: 2999 },
    { id: '3', name: 'Thyroid Profile Total', price: 750 },
    { id: '4', name: 'Lipid Profile', price: 600 },
    { id: '5', name: 'Liver Function Test', price: 650 },
    { id: '6', name: 'Kidney Function Test', price: 650 },
];

export default function PaymentLinksPage() {
    const [showCreate, setShowCreate] = useState(false);
    const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
    const [customerName, setCustomerName] = useState('');
    const [generatedLink, setGeneratedLink] = useState<string | null>(null);

    const selectedData = mockProducts.filter(p => selectedProducts.includes(p.id));
    const total = selectedData.reduce((s, p) => s + p.price, 0);

    const handleCopy = (link: string) => {
        navigator.clipboard.writeText(link);
        toast.success('Link copied to clipboard');
    };

    const handleGenerate = () => {
        if (!customerName || selectedProducts.length === 0) { toast.error('Fill customer and select products'); return; }
        setGeneratedLink(`https://docnow.in/pay/PL-${Date.now()}`);
    };

    const handleReset = () => {
        setShowCreate(false); setCustomerName(''); setSelectedProducts([]); setGeneratedLink(null);
    };

    const toggleProduct = (id: string) => {
        setSelectedProducts(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-semibold text-gray-900">Payment Links</h1>
                    <p className="text-gray-600 mt-1">Create and manage payment links for customers</p>
                </div>
                <button
                    onClick={() => setShowCreate(true)}
                    className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-white text-sm font-medium w-full sm:w-auto"
                    style={{ backgroundColor: '#4b2192' }}
                >
                    <Plus className="h-4 w-4" />
                    Create Payment Link
                </button>
            </div>

            {/* Coming Soon Banner */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div>
                        <h3 className="font-semibold text-blue-900">Preview Mode</h3>
                        <p className="text-sm text-blue-800 mt-1">
                            Payment link creation is currently showing demo data. Backend integration is coming soon.
                        </p>
                    </div>
                </div>
            </div>

            {/* Payment Links Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200">
                <div className="px-6 py-4 border-b border-gray-200">
                    <h2 className="font-semibold text-gray-900">Payment Links ({mockPaymentLinks.length})</h2>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-200 text-left">
                                <th className="px-6 py-3 font-medium text-gray-500">Link ID</th>
                                <th className="px-6 py-3 font-medium text-gray-500">Customer</th>
                                <th className="px-6 py-3 font-medium text-gray-500">Family Member</th>
                                <th className="px-6 py-3 font-medium text-gray-500">Amount</th>
                                <th className="px-6 py-3 font-medium text-gray-500">Status</th>
                                <th className="px-6 py-3 font-medium text-gray-500">Created</th>
                                <th className="px-6 py-3 font-medium text-gray-500 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {mockPaymentLinks.map((link, index) => (
                                <tr key={link.id} className={`border-b border-gray-100 ${index % 2 === 0 ? 'bg-gray-50/50' : ''}`}>
                                    <td className="px-6 py-3 font-medium font-mono text-sm">{link.linkId}</td>
                                    <td className="px-6 py-3">{link.customer}</td>
                                    <td className="px-6 py-3 text-gray-500">{link.familyMember || '—'}</td>
                                    <td className="px-6 py-3 font-semibold">₹{link.amount.toLocaleString()}</td>
                                    <td className="px-6 py-3">
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${link.status === 'Paid' ? 'bg-green-100 text-green-800'
                                            : link.status === 'Pending' ? 'bg-orange-100 text-orange-800'
                                                : 'bg-red-100 text-red-800'
                                            }`}>
                                            {link.status}
                                        </span>
                                    </td>
                                    <td className="px-6 py-3 text-gray-500">{link.createdAt}</td>
                                    <td className="px-6 py-3">
                                        <div className="flex items-center justify-end gap-2">
                                            <button
                                                onClick={() => handleCopy(link.link)}
                                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-medium hover:bg-gray-50"
                                            >
                                                <Copy className="h-3 w-3" />
                                                Copy
                                            </button>
                                            <button className="h-8 w-8 flex items-center justify-center rounded-lg border border-gray-300 hover:bg-gray-50">
                                                <MessageSquare className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Create Payment Link Modal */}
            {showCreate && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-xl max-w-xl w-full p-6 max-h-[85vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900">Create Payment Link</h3>
                                <p className="text-sm text-gray-500">Generate a payment link for your customer</p>
                            </div>
                            <button onClick={handleReset} className="p-1 hover:bg-gray-100 rounded-lg">
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        {!generatedLink ? (
                            <div className="space-y-4">
                                <div>
                                    <label className="text-sm font-medium text-gray-700 block mb-1">Customer Name *</label>
                                    <input
                                        value={customerName}
                                        onChange={(e) => setCustomerName(e.target.value)}
                                        placeholder="Enter customer name"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="text-sm font-medium text-gray-700 block mb-1">Select Tests/Packages *</label>
                                    <div className="border border-gray-300 rounded-lg p-3 max-h-48 overflow-y-auto space-y-2">
                                        {mockProducts.map(p => (
                                            <label key={p.id} className="flex items-center justify-between cursor-pointer py-1">
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedProducts.includes(p.id)}
                                                        onChange={() => toggleProduct(p.id)}
                                                        className="rounded border-gray-300"
                                                    />
                                                    <span className="text-sm">{p.name}</span>
                                                </div>
                                                <span className="text-sm font-medium">₹{p.price}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                                {/* Price Breakdown */}
                                <div className="bg-gray-50 rounded-lg p-4">
                                    <h4 className="font-medium text-gray-900 text-sm mb-3">Price Breakdown</h4>
                                    {selectedData.length > 0 ? (
                                        <>
                                            {selectedData.map(p => (
                                                <div key={p.id} className="flex justify-between text-sm py-1">
                                                    <span className="text-gray-600">{p.name}</span>
                                                    <span className="font-medium">₹{p.price}</span>
                                                </div>
                                            ))}
                                            <div className="border-t mt-2 pt-2 flex justify-between font-semibold">
                                                <span>Total Amount</span>
                                                <span style={{ color: '#4b2192' }}>₹{total}</span>
                                            </div>
                                        </>
                                    ) : (
                                        <p className="text-sm text-gray-500 text-center py-2">No products selected</p>
                                    )}
                                </div>
                                <div className="flex gap-3 justify-end pt-2">
                                    <button onClick={handleReset} className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium hover:bg-gray-50">Cancel</button>
                                    <button onClick={handleGenerate} className="px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: '#4b2192' }}>
                                        Generate Payment Link
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                                    <p className="text-sm text-green-800 font-medium">Payment link created successfully!</p>
                                </div>
                                <div>
                                    <label className="text-sm font-medium text-gray-700 block mb-1">Payment Link</label>
                                    <div className="flex gap-2">
                                        <input value={generatedLink} readOnly className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono bg-gray-50" />
                                        <button onClick={() => handleCopy(generatedLink)} className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
                                            <Copy className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-sm font-medium text-gray-700 block mb-1">Share Link</label>
                                    <div className="flex gap-2">
                                        <button className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
                                            <MessageSquare className="h-4 w-4" />
                                            WhatsApp
                                        </button>
                                        <button className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
                                            <Mail className="h-4 w-4" />
                                            Email
                                        </button>
                                        <button className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
                                            <ExternalLink className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                                <div className="flex justify-end pt-2">
                                    <button onClick={handleReset} className="px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: '#4b2192' }}>
                                        Create Another Link
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
