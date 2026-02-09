"use client";

import { useState, useEffect } from "react";
import { MapPin, Loader2, Navigation } from "lucide-react";
import api from "@/lib/api";
import { cn } from "@/lib/utils";
import { useLocation } from "@/contexts/LocationContext";

interface LocationSelectorProps {
    onLocationVerified?: (zipcode: string) => void;
}

export function LocationSelector({ onLocationVerified }: LocationSelectorProps) {
    const { updatePincode, updateCity } = useLocation();
    const [zipcode, setZipcode] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<"idle" | "success" | "error">("idle");

    const checkServiceability = async (code: string) => {
        setLoading(true);
        setError(null);
        try {
            // Mock latitude/longitude for now as they are required by backend but maybe ignored or approximate
            const response = await api.get('/location/serviceability', {
                params: { lat: '28.5', long: '77.0', zipcode: code }
            });

            if (response.data.status === true) {
                setStatus("success");
                updatePincode(code); // This will trigger geocoding and city update
                if (onLocationVerified) onLocationVerified(code);
            } else {
                setStatus("error");
                setError("Services currently unavailable in this area.");
            }
        } catch (err) {
            setStatus("error");
            setError("Failed to verify location. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const handleManualSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (zipcode.length === 6) {
            checkServiceability(zipcode);
        } else {
            setError("Please enter a valid 6-digit pincode");
        }
    };

    const handleDetectLocation = () => {
        if (!navigator.geolocation) {
            setError("Geolocation is not supported by your browser");
            return;
        }

        setLoading(true);
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                // In a real app, we would reverse geocode here to get the zipcode
                // For this demo, we can just simulate or ask user to confirm
                setLoading(false);
                alert("Location detected! (Reverse Geocoding to be implemented)");
            },
            (err) => {
                setLoading(false);
                setError("Unable to retrieve your location");
            }
        );
    };

    return (
        <div className="bg-white p-6 rounded-2xl shadow-xl max-w-md mx-auto -mt-10 relative z-20 border border-gray-100">
            <h3 className="text-lg font-semibold mb-4 text-center">Check Service Availability</h3>

            {status === 'success' ? (
                <div className="text-center py-4">
                    <div className="text-green-600 font-bold text-xl mb-2">You're covered!</div>
                    <p className="text-gray-500 mb-4">Services are available in {zipcode}</p>
                    <button
                        onClick={() => window.location.href = `/search?zip=${zipcode}`}
                        className="w-full bg-blue-600 text-white rounded-lg py-3 font-medium hover:bg-blue-700 transition"
                    >
                        Browse Packages
                    </button>
                    <button onClick={() => setStatus('idle')} className="text-sm text-gray-400 mt-4 underline">Change Location</button>
                </div>
            ) : (
                <>
                    <form onSubmit={handleManualSubmit} className="flex gap-2 mb-4">
                        <div className="relative flex-1">
                            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                                type="text"
                                value={zipcode}
                                onChange={(e) => setZipcode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                placeholder="Enter Pincode"
                                className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={loading || zipcode.length !== 6}
                            className="bg-slate-900 text-white px-6 rounded-lg font-medium hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Check"}
                        </button>
                    </form>

                    <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-gray-200"></div>
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-white px-2 text-gray-500">Or</span>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={handleDetectLocation}
                        className="mt-4 w-full flex items-center justify-center gap-2 text-blue-600 font-medium py-2 rounded-lg hover:bg-blue-50 transition-colors"
                    >
                        <Navigation className="w-4 h-4" />
                        Use Current Location
                    </button>

                    {error && (
                        <div className="mt-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg text-center font-medium">
                            {error}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
