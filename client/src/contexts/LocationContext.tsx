"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import api from '@/lib/api';
import { getApiUrl } from '@/lib/api';

interface LocationContextType {
    selectedCity: string;
    selectedPincode: string;
    latitude: string | null;
    longitude: string | null;
    serviceabilityStatus: 'idle' | 'loading' | 'success' | 'error';
    serviceabilityError: string | null;
    updateCity: (city: string) => void;
    updatePincode: (pincode: string) => void;
    checkAndSetPincode: (pincode: string) => Promise<boolean>;
    resetServiceability: () => void;
    isInitialized: boolean;
}

const LocationContext = createContext<LocationContextType | undefined>(undefined);

export function LocationProvider({ children }: { children: ReactNode }) {
    const [selectedCity, setSelectedCity] = useState('Select City');
    const [selectedPincode, setSelectedPincode] = useState('Select Pincode');
    const [latitude, setLatitude] = useState<string | null>(null);
    const [longitude, setLongitude] = useState<string | null>(null);
    const [isInitialized, setIsInitialized] = useState(false);
    const [serviceabilityStatus, setServiceabilityStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [serviceabilityError, setServiceabilityError] = useState<string | null>(null);

    // Load from localStorage on mount
    useEffect(() => {
        const savedCity = localStorage.getItem('docnow_selected_city');
        const savedPincode = localStorage.getItem('docnow_selected_pincode');
        const savedLat = localStorage.getItem('docnow_lat');
        const savedLong = localStorage.getItem('docnow_long');

        if (savedCity) setSelectedCity(savedCity);
        if (savedPincode) setSelectedPincode(savedPincode);
        if (savedLat) setLatitude(savedLat);
        if (savedLong) setLongitude(savedLong);

        setIsInitialized(true);
    }, []);

    const updateCity = (city: string) => {
        setSelectedCity(city);
        localStorage.setItem('docnow_selected_city', city);
    };

    const updatePincode = async (pincode: string) => {
        setSelectedPincode(pincode);
        localStorage.setItem('docnow_selected_pincode', pincode);

        // Fetch geodata and automatic city detection — fail silently
        if (/^\d{6}$/.test(pincode)) {
            try {
                const response = await fetch(
                    getApiUrl(`/location/geocode?pincode=${pincode}`)
                );

                if (!response.ok) return; // non-200 — silently skip

                const data = await response.json();

                if (data?.lat && data?.long) {
                    setLatitude(data.lat);
                    setLongitude(data.long);
                    localStorage.setItem('docnow_lat', data.lat);
                    localStorage.setItem('docnow_long', data.long);

                    if (data.city) {
                        setSelectedCity(data.city);
                        localStorage.setItem('docnow_selected_city', data.city);
                    }
                }
            } catch {
                // Network unavailable — silently skip, page continues working
                console.warn('[Location] Geocode unavailable, skipping auto-detection');
            }
        }
    };

    const checkAndSetPincode = async (pincode: string): Promise<boolean> => {
        setServiceabilityStatus('loading');
        setServiceabilityError(null);

        try {
            // Step 1: Geocode the pincode to get real lat/long
            let geocodeRes: Response;
            try {
                geocodeRes = await fetch(
                    getApiUrl(`/location/geocode?pincode=${pincode}`)
                );
            } catch {
                setServiceabilityStatus('error');
                setServiceabilityError('Unable to reach the server. Please check your connection and try again.');
                return false;
            }

            if (!geocodeRes.ok) {
                setServiceabilityStatus('error');
                setServiceabilityError('Could not find this pincode. Please check and try again.');
                return false;
            }

            const geo = await geocodeRes.json();

            if (!geo?.lat || !geo?.long) {
                setServiceabilityStatus('error');
                setServiceabilityError('Could not locate this pincode. Please try another.');
                return false;
            }

            // Step 2: Check serviceability using real coordinates
            let result: any;
            try {
                const response = await api.get('/location/serviceability', {
                    params: { lat: geo.lat, long: geo.long, zipcode: pincode }
                });
                result = response.data;
            } catch {
                setServiceabilityStatus('error');
                setServiceabilityError('Unable to verify serviceability. Please try again shortly.');
                return false;
            }

            const isServiceable = !!(result?.data?.zone_id);

            if (isServiceable) {
                setServiceabilityStatus('success');
                setSelectedPincode(pincode);
                localStorage.setItem('docnow_selected_pincode', pincode);
                setLatitude(geo.lat);
                setLongitude(geo.long);
                localStorage.setItem('docnow_lat', geo.lat);
                localStorage.setItem('docnow_long', geo.long);
                if (geo.city) {
                    setSelectedCity(geo.city);
                    localStorage.setItem('docnow_selected_city', geo.city);
                }
                return true;
            } else {
                setServiceabilityStatus('error');
                setServiceabilityError(`Services currently unavailable in pincode ${pincode}.`);
                return false;
            }
        } catch {
            // Catch-all — should not normally be reached
            setServiceabilityStatus('error');
            setServiceabilityError('Something went wrong. Please try again.');
            return false;
        }
    };

    const resetServiceability = () => {
        setServiceabilityStatus('idle');
        setServiceabilityError(null);
    };

    return (
        <LocationContext.Provider value={{
            selectedCity,
            selectedPincode,
            latitude,
            longitude,
            serviceabilityStatus,
            serviceabilityError,
            updateCity,
            updatePincode,
            checkAndSetPincode,
            resetServiceability,
            isInitialized
        }}>
            {children}
        </LocationContext.Provider>
    );
}

export function useLocation() {
    const context = useContext(LocationContext);
    if (context === undefined) {
        throw new Error('useLocation must be used within a LocationProvider');
    }
    return context;
}
