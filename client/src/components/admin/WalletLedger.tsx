import { Wallet } from 'lucide-react';
import { WalletLedgerEntry } from '@/types/admin';
import { formatDateTime } from '@/utils/formatters';

interface WalletLedgerProps {
    ledger: WalletLedgerEntry[];
}

export function WalletLedger({ ledger }: WalletLedgerProps) {
    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Wallet size={20} className="text-blue-600" />
                Wallet Transactions
            </h3>
            {ledger.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No wallet transactions</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Date</th>
                                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Type</th>
                                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Description</th>
                                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Amount</th>
                                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Balance</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {ledger.map((entry) => (
                                <tr key={entry.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-3 text-sm text-gray-600">{formatDateTime(entry.createdAt)}</td>
                                    <td className="px-4 py-3">
                                        <span
                                            className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${entry.amount > 0
                                                    ? 'bg-green-100 text-green-700'
                                                    : 'bg-red-100 text-red-700'
                                                }`}
                                        >
                                            {entry.amount > 0 ? 'Credit' : 'Debit'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-600">
                                        {entry.description}
                                        {entry.referenceId && (
                                            <span className="text-xs text-gray-400 ml-2">({entry.referenceId.slice(0, 8)})</span>
                                        )}
                                    </td>
                                    <td className={`px-4 py-3 font-medium ${entry.amount > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        {entry.amount > 0 ? '+' : ''}₹{Math.abs(entry.amount).toLocaleString('en-IN')}
                                    </td>
                                    <td className="px-4 py-3 font-medium">₹{entry.balanceAfter.toLocaleString('en-IN')}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
