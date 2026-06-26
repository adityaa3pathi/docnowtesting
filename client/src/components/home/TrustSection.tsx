import { Star, Shield, Clock, Users, FlaskConical } from 'lucide-react';

const trustStats = [
    { icon: Users, value: '5000+', label: 'Bookings', color: 'text-purple-600', bg: 'bg-purple-50' },
    { icon: Shield, value: 'NABL', label: 'Certified Labs', color: 'text-green-600', bg: 'bg-green-50' },
    { icon: FlaskConical, value: '200+', label: 'Tests Available', color: 'text-blue-600', bg: 'bg-blue-50' },
    { icon: Clock, value: '15 min', label: 'Callback', color: 'text-amber-600', bg: 'bg-amber-50' },
];

export function TrustSection() {
    return (
        <section className="py-6 md:py-8 bg-white border-b border-gray-100">
            <div className="container mx-auto px-4 max-w-5xl">
                {/* Rating headline */}
                <div className="flex flex-col items-center gap-3 mb-6">
                    <div className="flex items-center gap-1.5">
                        {[...Array(5)].map((_, i) => (
                            <Star
                                key={i}
                                className={`w-4.5 h-4.5 ${i < 5 ? 'text-amber-400 fill-amber-400' : 'text-gray-200 fill-gray-200'}`}
                            />
                        ))}
                        <span className="ml-1.5 text-sm font-bold text-gray-900">4.8/5</span>
                    </div>
                    <p className="text-sm text-gray-500 font-medium text-center">
                        Rated by <span className="font-bold text-gray-800">1200+ families</span> across India
                    </p>
                </div>

                {/* Trust stats grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {trustStats.map((stat) => (
                        <div
                            key={stat.label}
                            className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/50 px-3.5 py-3 transition-colors hover:border-gray-200"
                        >
                            <div className={`flex items-center justify-center w-9 h-9 rounded-lg ${stat.bg} flex-shrink-0`}>
                                <stat.icon className={`w-4.5 h-4.5 ${stat.color}`} />
                            </div>
                            <div className="min-w-0">
                                <div className="text-sm font-extrabold text-gray-900 leading-tight">{stat.value}</div>
                                <div className="text-[11px] font-medium text-gray-500 leading-tight">{stat.label}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
