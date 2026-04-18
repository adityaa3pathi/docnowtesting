"use client";

import { useEffect, useState } from 'react';
import { Copy, Gift, IndianRupee, Loader2, Share2, UserPlus, Wallet } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { Button } from '@/components/ui';

interface ReferralEntry {
    id: string;
    name: string | null;
    mobile: string;
    joinedAt: string;
    status: 'SIGNED_UP' | 'ORDER_COMPLETED';
}

interface RewardEntry {
    id: string;
    rewardType: 'REFEREE_SIGNUP' | 'REFERRER_ORDER';
    amount: number;
    processedAt: string | null;
    createdAt: string;
    triggerEvent: string;
    status: string;
    refereeName: string | null;
    refereeMobile: string | null;
    isBeneficiaryReferee: boolean;
}

interface ReferralData {
    referralCode: string;
    shareLink: string;
    rewardsConfig: {
        refereeBonus: number;
        referrerBonus: number;
    };
    stats: {
        totalReferrals: number;
        totalEarnings: number;
    };
    referrals: ReferralEntry[];
    rewardHistory: RewardEntry[];
}

export function ReferralTab() {
    const [data, setData] = useState<ReferralData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchReferrals = async () => {
            try {
                const res = await api.get('/profile/referrals');
                setData(res.data);
            } catch (error) {
                console.error('Error fetching referrals:', error);
                toast.error('Failed to load referral details');
            } finally {
                setLoading(false);
            }
        };

        fetchReferrals();
    }, []);

    const handleCopy = async (value: string, label: string) => {
        try {
            await navigator.clipboard.writeText(value);
            toast.success(`${label} copied`);
        } catch {
            toast.error(`Unable to copy ${label.toLowerCase()}`);
        }
    };

    const handleWhatsAppShare = () => {
        if (!data) return;
        const message = `Join DocNow with my referral code ${data.referralCode}. Sign up here: ${data.shareLink}`;
        window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
    };

    if (loading) return <div className="flex justify-center py-12"><Loader2 className="animate-spin" /></div>;
    if (!data) return null;

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-bold text-slate-900">My Referrals</h2>
                <p className="mt-1 text-sm text-slate-500">
                    Share your code, invite friends, and track the rewards you unlock together.
                </p>
            </div>

            <div className="rounded-2xl bg-gradient-to-br from-[#4b2192] to-[#6d3fcf] p-6 text-white shadow-lg">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <div className="mb-3 flex items-center gap-2 text-white/80">
                            <Gift className="h-5 w-5" />
                            <span className="text-sm font-medium">Your referral code</span>
                        </div>
                        <p className="text-3xl font-black tracking-[0.2em]">{data.referralCode}</p>
                        <p className="mt-3 max-w-2xl text-sm text-white/80">
                            Your friend gets ₹{data.rewardsConfig.refereeBonus.toLocaleString('en-IN')} at signup,
                            and you get ₹{data.rewardsConfig.referrerBonus.toLocaleString('en-IN')} after their first confirmed order.
                        </p>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
                        <Button
                            type="button"
                            variant="outline"
                            className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                            onClick={() => handleCopy(data.referralCode, 'Referral code')}
                        >
                            <Copy className="mr-2 h-4 w-4" />
                            Copy Code
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                            onClick={() => handleCopy(data.shareLink, 'Invite link')}
                        >
                            <Share2 className="mr-2 h-4 w-4" />
                            Copy Link
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                            onClick={handleWhatsAppShare}
                        >
                            <Share2 className="mr-2 h-4 w-4" />
                            Share on WhatsApp
                        </Button>
                    </div>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                    <div className="mb-3 flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                            <UserPlus className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-500">Total referrals</p>
                            <p className="text-2xl font-bold text-slate-900">{data.stats.totalReferrals}</p>
                        </div>
                    </div>
                    <p className="text-sm text-gray-500">Friends who joined using your referral code.</p>
                </div>

                <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                    <div className="mb-3 flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                            <IndianRupee className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-500">Referral earnings</p>
                            <p className="text-2xl font-bold text-slate-900">₹{data.stats.totalEarnings.toLocaleString('en-IN')}</p>
                        </div>
                    </div>
                    <p className="text-sm text-gray-500">Total referral rewards credited to you so far.</p>
                </div>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-bold text-slate-900">How it works</h3>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                    <div className="rounded-xl bg-slate-50 p-4">
                        <p className="text-sm font-semibold text-slate-900">1. Share your code</p>
                        <p className="mt-1 text-sm text-slate-500">Invite friends with your personal code or link.</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-4">
                        <p className="text-sm font-semibold text-slate-900">2. Friend signs up</p>
                        <p className="mt-1 text-sm text-slate-500">They get ₹{data.rewardsConfig.refereeBonus.toLocaleString('en-IN')} once they create their account with your code.</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-4">
                        <p className="text-sm font-semibold text-slate-900">3. First order confirmed</p>
                        <p className="mt-1 text-sm text-slate-500">You get ₹{data.rewardsConfig.referrerBonus.toLocaleString('en-IN')} after their first confirmed booking.</p>
                    </div>
                </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
                <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-900">Referral activity</h3>
                    {data.referrals.length === 0 ? (
                        <div className="py-12 text-center text-gray-400">
                            <UserPlus className="mx-auto mb-3 h-12 w-12 opacity-40" />
                            <p className="font-medium text-gray-500">No referrals yet</p>
                            <p className="mt-1 text-sm">Share your code to start earning rewards.</p>
                        </div>
                    ) : (
                        <div className="mt-4 space-y-3">
                            {data.referrals.map((referral) => (
                                <div key={referral.id} className="flex items-center justify-between rounded-xl border border-gray-100 p-4">
                                    <div>
                                        <p className="font-medium text-slate-900">{referral.name || referral.mobile}</p>
                                        <p className="text-xs text-gray-400">
                                            Joined {new Date(referral.joinedAt).toLocaleDateString('en-IN', {
                                                day: 'numeric',
                                                month: 'short',
                                                year: 'numeric'
                                            })}
                                        </p>
                                    </div>
                                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${referral.status === 'ORDER_COMPLETED'
                                            ? 'bg-emerald-50 text-emerald-700'
                                            : 'bg-amber-50 text-amber-700'
                                        }`}>
                                        {referral.status === 'ORDER_COMPLETED' ? 'First order completed' : 'Signed up'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-900">Reward history</h3>
                    {data.rewardHistory.length === 0 ? (
                        <div className="py-12 text-center text-gray-400">
                            <Wallet className="mx-auto mb-3 h-12 w-12 opacity-40" />
                            <p className="font-medium text-gray-500">No rewards yet</p>
                            <p className="mt-1 text-sm">Referral credits will appear here once they are processed.</p>
                        </div>
                    ) : (
                        <div className="mt-4 space-y-3">
                            {data.rewardHistory.map((reward) => (
                                <div key={reward.id} className="rounded-xl border border-gray-100 p-4">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <p className="font-medium text-slate-900">
                                                {reward.rewardType === 'REFEREE_SIGNUP' && reward.isBeneficiaryReferee
                                                    ? 'Welcome referral bonus'
                                                    : `Referral reward for ${reward.refereeName || reward.refereeMobile || 'your friend'}`}
                                            </p>
                                            <p className="mt-1 text-xs text-gray-400">
                                                {new Date(reward.processedAt || reward.createdAt).toLocaleDateString('en-IN', {
                                                    day: 'numeric',
                                                    month: 'short',
                                                    year: 'numeric'
                                                })}
                                            </p>
                                        </div>
                                        <span className="text-sm font-semibold text-emerald-600">
                                            +₹{reward.amount.toLocaleString('en-IN')}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
