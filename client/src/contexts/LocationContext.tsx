"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import api from '@/lib/api';

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

        // Fetch geodata and automatic city detection
        if (/^\d{6}$/.test(pincode)) {
            try {
                const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api'}/location/geocode?pincode=${pincode}`);
                const data = await response.json();

                if (data && data.lat && data.long) {
                    setLatitude(data.lat);
                    setLongitude(data.long);
                    localStorage.setItem('docnow_lat', data.lat);
                    localStorage.setItem('docnow_long', data.long);

                    if (data.city) {
                        setSelectedCity(data.city);
                        localStorage.setItem('docnow_selected_city', data.city);
                    }
                }
            } catch (error) {
                console.error('Failed to geocode pincode:', error);
            }
        }
    };

    const checkAndSetPincode = async (pincode: string): Promise<boolean> => {
        setServiceabilityStatus('loading');
        setServiceabilityError(null);

        try {
            // Step 1: Geocode the pincode to get real lat/long
            const geocodeRes = await fetch(
                `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api'}/location/geocode?pincode=${pincode}`
            );

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
            const response = await api.get('/location/serviceability', {
                params: { lat: geo.lat, long: geo.long, zipcode: pincode }
            });

            const result = response.data;
            const isServiceable = !!(result?.data?.zone_id);

            if (isServiceable) {
                setServiceabilityStatus('success');
                // Persist pincode + set lat/long/city from geocode data
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
            setServiceabilityStatus('error');
            setServiceabilityError('Failed to verify location. Please try again.');
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
