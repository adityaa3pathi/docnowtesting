"use client";

import { Wallet, ArrowUpCircle, ArrowDownCircle, Loader2, IndianRupee } from 'lucide-react';
import { useState, useEffect } from 'react';
import api from '@/lib/api';

interface Transaction {
    id: string;
    type: 'CREDIT' | 'DEBIT';
    amount: number;
    balanceAfter: number;
    description: string;
    referenceType?: string;
    createdAt: string;
}

export function WalletTab() {
    const [balance, setBalance] = useState(0);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchWallet();
    }, []);

    const fetchWallet = async () => {
        try {
            const res = await api.get('/profile/wallet');
            setBalance(res.data.balance || 0);
            setTransactions(res.data.transactions || []);
        } catch (error) {
            console.error('Error fetching wallet:', error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) return <div className="flex justify-center py-12"><Loader2 className="animate-spin" /></div>;

    return (
        <div>
            {/* Balance Card */}
            <div className="bg-gradient-to-br from-[#4b2192] to-[#6d3fcf] rounded-2xl p-6 mb-8 text-white shadow-lg">
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                        <Wallet className="w-5 h-5" />
                    </div>
                    <p className="text-white/80 text-sm font-medium">Wallet Balance</p>
                </div>
                <p className="text-3xl font-bold flex items-center gap-1">
                    <IndianRupee className="w-7 h-7" />
                    {balance.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                </p>
                <p className="text-white/60 text-xs mt-2">Use your wallet balance during checkout</p>
            </div>

            {/* Transaction History */}
            <h2 className="text-lg font-bold mb-4">Transaction History</h2>

            {transactions.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                    <Wallet className="w-12 h-12 mx-auto mb-3 opacity-40" />
                    <p className="font-medium">No transactions yet</p>
                    <p className="text-sm mt-1">Your wallet transactions will appear here</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {transactions.map((txn) => (
                        <div key={txn.id} className="flex items-center justify-between p-4 border border-gray-100 rounded-xl hover:bg-gray-50 transition-colors">
                            <div className="flex items-center gap-3">
                                <div className={`w-9 h-9 rounded-full flex items-center justify-center ${txn.amount > 0
                                        ? 'bg-green-50 text-green-600'
                                        : 'bg-red-50 text-red-500'
                                    }`}>
                                    {txn.amount > 0
                                        ? <ArrowDownCircle className="w-5 h-5" />
                                        : <ArrowUpCircle className="w-5 h-5" />
                                    }
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-gray-900">{txn.description}</p>
                                    <p className="text-xs text-gray-400 mt-0.5">
                                        {new Date(txn.createdAt).toLocaleDateString('en-IN', {
                                            day: 'numeric', month: 'short', year: 'numeric',
                                            hour: '2-digit', minute: '2-digit'
                                        })}
                                        {txn.referenceType && (
                                            <span className="ml-2 px-1.5 py-0.5 bg-gray-100 rounded text-[10px] uppercase tracking-wider">
                                                {txn.referenceType.replace('_', ' ')}
                                            </span>
                                        )}
                                    </p>
                                </div>
                            </div>
                            <div className="text-right">
                                <p className={`text-sm font-semibold ${txn.amount > 0 ? 'text-green-600' : 'text-red-500'}`}>
                                    {txn.amount > 0 ? '+' : ''}₹{Math.abs(txn.amount).toLocaleString('en-IN')}
                                </p>
                                <p className="text-[11px] text-gray-400">Bal: ₹{txn.balanceAfter.toLocaleString('en-IN')}</p>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
