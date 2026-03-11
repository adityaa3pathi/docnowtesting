"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import toast from 'react-hot-toast';
import api from '@/lib/api';

interface LocationContextType {
    selectedCity: string;
    selectedPincode: string;
    latitude: string | null;
    longitude: string | null;
    isServiceable: boolean | null;
    isCheckingServiceability: boolean;
    updateCity: (city: string) => void;
    updatePincode: (pincode: string) => Promise<void>;
    isInitialized: boolean;
}

const LocationContext = createContext<LocationContextType | undefined>(undefined);

export function LocationProvider({ children }: { children: ReactNode }) {
    const [selectedCity, setSelectedCity] = useState('Select City');
    const [selectedPincode, setSelectedPincode] = useState('Select Pincode');
    const [latitude, setLatitude] = useState<string | null>(null);
    const [longitude, setLongitude] = useState<string | null>(null);
    const [isServiceable, setIsServiceable] = useState<boolean | null>(null);
    const [isCheckingServiceability, setIsCheckingServiceability] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);

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

        if (!/^\d{6}$/.test(pincode)) return;

        setIsCheckingServiceability(true);
        setIsServiceable(null);

        let lat = '28.5';
        let long = '77.0';

        try {
            // Step 1: Geocode the pincode to get lat/long and city
            const geoResponse = await fetch(
                `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api'}/location/geocode?pincode=${pincode}`
            );
            const geoData = await geoResponse.json();

            if (geoData && geoData.lat && geoData.long) {
                lat = geoData.lat;
                long = geoData.long;
                setLatitude(lat);
                setLongitude(long);
                localStorage.setItem('docnow_lat', lat);
                localStorage.setItem('docnow_long', long);

                if (geoData.city) {
                    setSelectedCity(geoData.city);
                    localStorage.setItem('docnow_selected_city', geoData.city);
                }
            }
        } catch (error) {
            console.error('Failed to geocode pincode:', error);
        }

        try {
            // Step 2: Check serviceability with the lat/long
            const serviceResponse = await api.get('/location/serviceability', {
                params: { lat, long, zipcode: pincode }
            });

            if (serviceResponse.data.status === true) {
                setIsServiceable(true);
                toast.success("You're covered! Services are available in your area. ✅");
            } else {
                setIsServiceable(false);
                toast.error("Services are currently unavailable in this area.");
            }
        } catch (error) {
            console.error('Failed to check serviceability:', error);
            setIsServiceable(false);
            toast.error("Failed to verify service availability. Please try again.");
        } finally {
            setIsCheckingServiceability(false);
        }
    };

    return (
        <LocationContext.Provider value={{
            selectedCity,
            selectedPincode,
            latitude,
            longitude,
            isServiceable,
            isCheckingServiceability,
            updateCity,
            updatePincode,
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
