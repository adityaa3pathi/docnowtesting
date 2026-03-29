"use client";

import { useState } from "react";
import { MapPin, Loader2, Navigation, CheckCircle2, ArrowRight } from "lucide-react";
import toast from "react-hot-toast";
import { useLocation } from "@/contexts/LocationContext";

interface LocationSelectorProps {
    onLocationVerified?: (zipcode: string) => void;
    /** When true, renders with transparent/glass style (for use inside dark containers) */
    variant?: 'default' | 'glass';
}

export function LocationSelector({ onLocationVerified, variant = 'default' }: LocationSelectorProps) {
    const {
        selectedPincode,
        checkAndSetPincode,
        serviceabilityStatus,
        serviceabilityError,
        resetServiceability,
    } = useLocation();

    const [zipcode, setZipcode] = useState("");

    const loading = serviceabilityStatus === 'loading';
    const isGlass = variant === 'glass';

    const handleManualSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (zipcode.length === 6) {
            const ok = await checkAndSetPincode(zipcode);
            if (ok && onLocationVerified) onLocationVerified(zipcode);
        } else {
            toast.error("Please enter a valid 6-digit pincode");
        }
    };

    const handleDetectLocation = () => {
        if (!navigator.geolocation) {
            toast.error("Geolocation is not supported by your browser");
            return;
        }

        navigator.geolocation.getCurrentPosition(
            async () => {
                toast.success("Location detected! (Reverse Geocoding to be implemented)");
            },
            () => {
                toast.error("Unable to retrieve your location");
            }
        );
    };

    const handleChangeLocation = () => {
        resetServiceability();
        setZipcode("");
    };

    return (
        <div className={`p-6 rounded-2xl max-w-md mx-auto relative z-20 ${
            isGlass 
                ? 'bg-white/10 backdrop-blur-md border border-white/10' 
                : 'bg-white shadow-xl border border-gray-100 -mt-10'
        }`}>
            <h3 className={`text-lg font-semibold mb-4 text-center ${
                isGlass ? 'text-white' : 'text-gray-900'
            }`}>
                Check Service Availability
            </h3>

            {serviceabilityStatus === 'success' ? (
                <div className="text-center py-4">
                    <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                        <CheckCircle2 className="w-6 h-6 text-green-600" />
                    </div>
                    <div className="text-green-600 font-bold text-xl mb-1">You&apos;re covered!</div>
                    <p className={`mb-4 text-sm ${isGlass ? 'text-white/60' : 'text-gray-500'}`}>
                        Services are available in {selectedPincode}
                    </p>
                    <button
                        onClick={() => window.location.href = `/search?zip=${selectedPincode}`}
                        className="w-full bg-primary text-white rounded-xl py-3 font-bold hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
                    >
                        Browse Packages
                        <ArrowRight className="w-4 h-4" />
                    </button>
                    <button
                        onClick={handleChangeLocation}
                        className={`text-sm mt-4 underline ${isGlass ? 'text-white/50 hover:text-white/80' : 'text-gray-400 hover:text-gray-600'} transition-colors`}
                    >
                        Change Location
                    </button>
                </div>
            ) : (
                <>
                    <form onSubmit={handleManualSubmit} className="flex gap-2 mb-4">
                        <div className="relative flex-1">
                            <MapPin className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isGlass ? 'text-white/40' : 'text-gray-400'}`} />
                            <input
                                type="text"
                                value={zipcode}
                                onChange={(e) => setZipcode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                placeholder="Enter Pincode"
                                className={`w-full pl-10 pr-4 py-3 rounded-xl focus:outline-none focus:ring-2 transition-all font-medium ${
                                    isGlass 
                                        ? 'bg-white/10 border border-white/20 text-white placeholder:text-white/40 focus:ring-white/30 focus:border-white/40' 
                                        : 'bg-gray-50 border border-gray-200 text-gray-900 focus:ring-primary/20 focus:border-primary'
                                }`}
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={loading || zipcode.length !== 6}
                            className="bg-primary text-white px-6 rounded-xl font-bold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-95"
                        >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Check"}
                        </button>
                    </form>

                    <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                            <div className={`w-full border-t ${isGlass ? 'border-white/10' : 'border-gray-200'}`}></div>
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className={`px-2 ${isGlass ? 'bg-transparent text-white/40' : 'bg-white text-gray-500'}`}>Or</span>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={handleDetectLocation}
                        className={`mt-4 w-full flex items-center justify-center gap-2 font-medium py-2.5 rounded-xl transition-colors ${
                            isGlass 
                                ? 'text-purple-300 hover:bg-white/5' 
                                : 'text-primary hover:bg-primary/5'
                        }`}
                    >
                        <Navigation className="w-4 h-4" />
                        Use Current Location
                    </button>

                    {serviceabilityError && (
                        <div className="mt-4 p-3 bg-red-50 text-red-600 text-sm rounded-xl text-center font-medium border border-red-100">
                            {serviceabilityError}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
