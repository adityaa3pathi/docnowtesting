import { AdminUser } from '@/types/admin';

interface WalletModalProps {
    selectedUser: AdminUser;
    walletAction: 'credit' | 'debit';
    setWalletAction: (action: 'credit' | 'debit') => void;
    walletAmount: string;
    setWalletAmount: (amount: string) => void;
    walletReason: string;
    setWalletReason: (reason: string) => void;
    submitting: boolean;
    onSubmit: () => void;
    onClose: () => void;
}

export function WalletModal({
    selectedUser,
    walletAction,
    setWalletAction,
    walletAmount,
    setWalletAmount,
    walletReason,
    setWalletReason,
    submitting,
    onSubmit,
    onClose
}: WalletModalProps) {
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl">
                <h2 className="text-xl font-semibold text-gray-900 mb-4">Adjust Wallet Balance</h2>
                <p className="text-sm text-gray-600 mb-4">
                    User: <span className="font-medium">{selectedUser.name || selectedUser.mobile}</span>
                    <br />
                    Current Balance: <span className="font-medium">₹{selectedUser.walletBalance.toLocaleString('en-IN')}</span>
                </p>

                <div className="space-y-4">
                    <div className="flex gap-2">
                        <button
                            onClick={() => setWalletAction('credit')}
                            className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${walletAction === 'credit'
                                    ? 'bg-green-600 text-white'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                        >
                            Credit (+)
                        </button>
                        <button
                            onClick={() => setWalletAction('debit')}
                            className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${walletAction === 'debit'
                                    ? 'bg-red-600 text-white'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                        >
                            Debit (-)
                        </button>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Amount (₹)</label>
                        <input
                            type="number"
                            value={walletAmount}
                            onChange={(e) => setWalletAmount(e.target.value)}
                            placeholder="Enter amount"
                            min="1"
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4b2192]"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                        <textarea
                            value={walletReason}
                            onChange={(e) => setWalletReason(e.target.value)}
                            placeholder="Enter reason for adjustment"
                            rows={3}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4b2192] resize-none"
                        />
                    </div>
                </div>

                <div className="flex gap-3 mt-6">
                    <button
                        onClick={onClose}
                        className="flex-1 py-2 px-4 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onSubmit}
                        disabled={submitting}
                        className="flex-1 py-2 px-4 bg-[#4b2192] text-white rounded-lg hover:bg-[#3d1a78] transition-colors disabled:opacity-50"
                    >
                        {submitting ? 'Processing...' : `Confirm ${walletAction === 'credit' ? 'Credit' : 'Debit'}`}
                    </button>
                </div>
            </div>
        </div>
    );
}
