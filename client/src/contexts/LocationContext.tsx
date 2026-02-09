"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface LocationContextType {
    selectedCity: string;
    selectedPincode: string;
    latitude: string | null;
    longitude: string | null;
    updateCity: (city: string) => void;
    updatePincode: (pincode: string) => void;
    isInitialized: boolean;
}

const LocationContext = createContext<LocationContextType | undefined>(undefined);

export function LocationProvider({ children }: { children: ReactNode }) {
    const [selectedCity, setSelectedCity] = useState('Select City');
    const [selectedPincode, setSelectedPincode] = useState('Select Pincode');
    const [latitude, setLatitude] = useState<string | null>(null);
    const [longitude, setLongitude] = useState<string | null>(null);
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

    return (
        <LocationContext.Provider value={{
            selectedCity,
            selectedPincode,
            latitude,
            longitude,
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
