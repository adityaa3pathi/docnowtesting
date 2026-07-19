'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Loader2, MapPin, Calendar, TestTubes, ArrowRight, Heart } from 'lucide-react';
import api from '@/lib/api';

interface ActiveCamp {
    id: string;
    name: string;
    description: string | null;
    location: string;
    city: string;
    startDate: string;
    endDate: string;
    price: number;
    _count: {
        items: number;
    };
}

export default function CampsListingPage() {
    const [camps, setCamps] = useState<ActiveCamp[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchCamps = async () => {
            try {
                const res = await api.get('/camps/active');
                setCamps(res.data.camps || res.data || []);
            } catch (error) {
                console.error('Failed to fetch camps', error);
            } finally {
                setIsLoading(false);
            }
        };
        fetchCamps();
    }, []);

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
        });
    };

    const formatDateFull = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        });
    };

    if (isLoading) {
        return <CampsSkeleton />;
    }

    return (
        <div className="w-full min-h-screen bg-gray-50">
            {/* Hero Header */}
            <div className="bg-gradient-to-br from-[#4b2192] via-[#5b2db0] to-[#7c3aed] text-white">
                <div className="container mx-auto px-4 py-12 sm:py-16 max-w-6xl">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="p-2.5 bg-white/10 rounded-xl backdrop-blur-sm">
                            <Heart className="w-6 h-6" />
                        </div>
                        <span className="text-white/70 text-sm font-medium uppercase tracking-wider">DocNow Health Camps</span>
                    </div>
                    <h1 className="text-3xl sm:text-4xl font-bold mb-3">
                        Health Camps Near You
                    </h1>
                    <p className="text-white/70 text-base sm:text-lg max-w-xl">
                        Get comprehensive health check-ups at affordable prices. Join a camp near you and take charge of your health.
                    </p>
                </div>
            </div>

            <div className="container mx-auto px-4 py-8 sm:py-12 max-w-6xl">
                {camps.length === 0 ? (
                    <div className="text-center py-16 bg-white rounded-2xl border border-gray-100 shadow-sm">
                        <Heart className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                        <h3 className="text-lg font-semibold text-gray-700 mb-2">No active camps available right now</h3>
                        <p className="text-gray-400 max-w-md mx-auto">
                            We&apos;re planning new health camps in your area. Check back soon for upcoming events!
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {camps.map(camp => (
                            <Link
                                key={camp.id}
                                href={`/camps/${camp.id}`}
                                className="group bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-lg hover:border-purple-100 transition-all duration-300 hover:-translate-y-1"
                            >
                                {/* Card Top Accent */}
                                <div className="h-1.5 bg-gradient-to-r from-[#4b2192] to-[#7c3aed]" />

                                <div className="p-5 sm:p-6">
                                    {/* Name & Description */}
                                    <h3 className="text-lg font-bold text-gray-900 mb-1.5 group-hover:text-[#4b2192] transition-colors">
                                        {camp.name}
                                    </h3>
                                    {camp.description && (
                                        <p className="text-sm text-gray-500 mb-4 line-clamp-2">{camp.description}</p>
                                    )}

                                    {/* Details */}
                                    <div className="space-y-2.5 mb-5">
                                        <div className="flex items-center gap-2.5 text-sm text-gray-600">
                                            <MapPin size={16} className="text-gray-400 shrink-0" />
                                            <span className="truncate">{camp.location}, {camp.city}</span>
                                        </div>
                                        <div className="flex items-center gap-2.5 text-sm text-gray-600">
                                            <Calendar size={16} className="text-gray-400 shrink-0" />
                                            <span>{formatDate(camp.startDate)} — {formatDateFull(camp.endDate)}</span>
                                        </div>
                                        <div className="flex items-center gap-2.5 text-sm text-gray-600">
                                            <TestTubes size={16} className="text-gray-400 shrink-0" />
                                            <span>{camp._count.items} tests & packages included</span>
                                        </div>
                                    </div>

                                    {/* Price & CTA */}
                                    <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                                        <div>
                                            <div className="text-xs text-gray-400 font-medium uppercase tracking-wider">Camp Price</div>
                                            <div className="text-2xl font-bold text-gray-900">
                                                ₹{camp.price}
                                            </div>
                                        </div>
                                        <div className="bg-[#4b2192] text-white px-5 py-2.5 rounded-xl flex items-center gap-2 font-medium group-hover:bg-[#3d1a7a] transition-all shadow-lg shadow-purple-900/10 active:scale-95 text-sm">
                                            Register Now <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
                                        </div>
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function CampsSkeleton() {
    return (
        <div className="w-full min-h-screen bg-gray-50">
            {/* Header Skeleton */}
            <div className="bg-gradient-to-br from-[#4b2192] via-[#5b2db0] to-[#7c3aed]">
                <div className="container mx-auto px-4 py-12 sm:py-16 max-w-6xl">
                    <div className="h-8 w-48 bg-white/20 rounded-lg animate-pulse mb-4" />
                    <div className="h-10 w-80 bg-white/20 rounded-lg animate-pulse mb-3" />
                    <div className="h-5 w-96 bg-white/10 rounded-lg animate-pulse" />
                </div>
            </div>

            <div className="container mx-auto px-4 py-8 sm:py-12 max-w-6xl">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                            <div className="h-1.5 bg-gray-200 animate-pulse" />
                            <div className="p-5 sm:p-6 space-y-4">
                                <div className="h-6 w-3/4 bg-gray-200 rounded animate-pulse" />
                                <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
                                <div className="space-y-2.5">
                                    <div className="h-4 w-2/3 bg-gray-100 rounded animate-pulse" />
                                    <div className="h-4 w-1/2 bg-gray-100 rounded animate-pulse" />
                                    <div className="h-4 w-3/5 bg-gray-100 rounded animate-pulse" />
                                </div>
                                <div className="pt-4 border-t border-gray-100 flex justify-between items-center">
                                    <div>
                                        <div className="h-3 w-16 bg-gray-100 rounded animate-pulse mb-1.5" />
                                        <div className="h-8 w-20 bg-gray-200 rounded animate-pulse" />
                                    </div>
                                    <div className="h-10 w-32 bg-gray-200 rounded-xl animate-pulse" />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
