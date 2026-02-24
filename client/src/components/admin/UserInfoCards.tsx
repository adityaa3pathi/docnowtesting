import { User, Phone, Mail, Calendar, Wallet, Users } from 'lucide-react';
import { UserDetails, ReferralInfo } from '@/types/admin';
import { formatDate } from '@/utils/formatters';

interface UserInfoCardsProps {
    user: UserDetails;
    walletBalance: number;
    walletTransactionCount: number;
    referralInfo: ReferralInfo;
}

export function UserInfoCards({ user, walletBalance, walletTransactionCount, referralInfo }: UserInfoCardsProps) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Profile Card */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <User size={20} className="text-[#4b2192]" />
                    Profile Information
                </h3>
                <div className="space-y-3">
                    <div className="flex items-center gap-3 text-gray-700">
                        <Phone size={16} className="text-gray-400" />
                        <span>{user.mobile}</span>
                    </div>
                    <div className="flex items-center gap-3 text-gray-700">
                        <Mail size={16} className="text-gray-400" />
                        <span>{user.email || 'Not provided'}</span>
                    </div>
                    <div className="flex items-center gap-3 text-gray-700">
                        <Calendar size={16} className="text-gray-400" />
                        <span>Joined {formatDate(user.createdAt)}</span>
                    </div>
                </div>
            </div>

            {/* Wallet Card */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <Wallet size={20} className="text-blue-600" />
                    Wallet Balance
                </h3>
                <p className="text-3xl font-bold text-gray-900">
                    ₹{walletBalance.toLocaleString('en-IN')}
                </p>
                <p className="text-sm text-gray-500 mt-2">
                    {walletTransactionCount} transactions
                </p>
            </div>

            {/* Referral Card */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <Users size={20} className="text-purple-600" />
                    Referral Info
                </h3>
                <div className="space-y-3">
                    <div>
                        <p className="text-sm text-gray-500">Referral Code</p>
                        <p className="font-mono text-lg text-[#4b2192]">{user.referralCode || 'N/A'}</p>
                    </div>
                    <div>
                        <p className="text-sm text-gray-500">Referred By</p>
                        <p className="font-medium">
                            {referralInfo.referredBy
                                ? `${referralInfo.referredBy.name || referralInfo.referredBy.mobile}`
                                : 'Direct signup'}
                        </p>
                    </div>
                    <div>
                        <p className="text-sm text-gray-500">Users Referred</p>
                        <p className="text-xl font-semibold">{referralInfo.referredCount}</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
