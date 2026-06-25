'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    APIProvider,
    Map,
    AdvancedMarker,
    useMap,
    useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { MapPin, Navigation, Search, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import api from '@/lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface LocationResult {
    lat: string;
    lng: string;
    formattedAddress: string;
    city: string;
    pincode: string;
}

interface LocationPickerProps {
    /** Initial coordinates (edit mode or pre-filled) */
    initialPosition?: { lat: number; lng: number };
    /** Initial pincode to geocode if no position provided */
    initialPincode?: string;
    /** Called when user confirms a location */
    onLocationSelect: (location: LocationResult) => void;
    /** Height of the map container */
    height?: string;
    /** Whether to show the confirm button (false = auto-emit on every change) */
    showConfirm?: boolean;
}

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

// Default center: Jaipur (primary market)
const DEFAULT_CENTER = { lat: 26.9124, lng: 75.7873 };
const DEFAULT_ZOOM = 14;

// ─── Main Export ───────────────────────────────────────────────────────────────

export default function LocationPicker({
    initialPosition,
    initialPincode,
    onLocationSelect,
    height = '300px',
    showConfirm = true,
}: LocationPickerProps) {
    return (
        <APIProvider apiKey={API_KEY} libraries={['places', 'geocoding', 'marker']}>
            <LocationPickerInner
                initialPosition={initialPosition}
                initialPincode={initialPincode}
                onLocationSelect={onLocationSelect}
                height={height}
                showConfirm={showConfirm}
            />
        </APIProvider>
    );
}

// ─── Inner Component (needs APIProvider context) ───────────────────────────────

function LocationPickerInner({
    initialPosition,
    initialPincode,
    onLocationSelect,
    height,
    showConfirm,
}: LocationPickerProps) {
    const map = useMap();
    const geocodingLib = useMapsLibrary('geocoding');
    const placesLib = useMapsLibrary('places');

    const [position, setPosition] = useState(initialPosition || DEFAULT_CENTER);
    const [address, setAddress] = useState('');
    const [city, setCity] = useState('');
    const [pincode, setPincode] = useState('');
    const [locating, setLocating] = useState(false);
    const [serviceability, setServiceability] = useState<'checking' | 'yes' | 'no' | null>(null);

    const geocoderRef = useRef<google.maps.Geocoder | null>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

    // Initialize geocoder
    useEffect(() => {
        if (geocodingLib) {
            geocoderRef.current = new geocodingLib.Geocoder();
        }
    }, [geocodingLib]);

    // Initialize Places Autocomplete
    useEffect(() => {
        if (!placesLib || !searchInputRef.current) return;

        const autocomplete = new placesLib.Autocomplete(searchInputRef.current, {
            componentRestrictions: { country: 'in' },
            fields: ['geometry', 'formatted_address', 'address_components'],
        });

        autocomplete.addListener('place_changed', () => {
            const place = autocomplete.getPlace();
            if (place.geometry?.location) {
                const newPos = {
                    lat: place.geometry.location.lat(),
                    lng: place.geometry.location.lng(),
                };
                setPosition(newPos);
                map?.panTo(newPos);
                map?.setZoom(17);
                extractAddressComponents(place.address_components, place.formatted_address);
            }
        });

        autocompleteRef.current = autocomplete;

        return () => {
            google.maps.event.clearInstanceListeners(autocomplete);
        };
    }, [placesLib, map]);

    // Geocode initial pincode if no position provided
    useEffect(() => {
        if (!initialPosition && initialPincode && geocoderRef.current) {
            geocoderRef.current.geocode(
                { address: `${initialPincode}, India` },
                (results, status) => {
                    if (status === 'OK' && results?.[0]) {
                        const loc = results[0].geometry.location;
                        const newPos = { lat: loc.lat(), lng: loc.lng() };
                        setPosition(newPos);
                        map?.panTo(newPos);
                    }
                }
            );
        }
    }, [initialPincode, initialPosition, geocoderRef.current, map]);

    // Extract city + pincode from address components
    const extractAddressComponents = useCallback(
        (components?: google.maps.GeocoderAddressComponent[], formatted?: string | null) => {
            let foundCity = '';
            let foundPincode = '';

            if (components) {
                for (const c of components) {
                    if (c.types.includes('locality')) foundCity = c.long_name;
                    else if (c.types.includes('administrative_area_level_2') && !foundCity) foundCity = c.long_name;
                    if (c.types.includes('postal_code')) foundPincode = c.long_name;
                }
            }

            setCity(foundCity);
            setPincode(foundPincode);
            setAddress(formatted || '');

            // Check serviceability
            if (foundPincode) {
                checkServiceability(position.lat, position.lng, foundPincode);
            }
        },
        [position]
    );

    // Reverse geocode on pin drop
    const reverseGeocode = useCallback(
        (lat: number, lng: number) => {
            if (!geocoderRef.current) return;
            geocoderRef.current.geocode({ location: { lat, lng } }, (results, status) => {
                if (status === 'OK' && results?.[0]) {
                    extractAddressComponents(results[0].address_components, results[0].formatted_address);
                    // Update search input with the address
                    if (searchInputRef.current) {
                        searchInputRef.current.value = results[0].formatted_address || '';
                    }
                }
            });
        },
        [extractAddressComponents]
    );

    // Check Healthians serviceability
    const checkServiceability = async (lat: number, lng: number, zip: string) => {
        setServiceability('checking');
        try {
            const res = await api.get('/location/serviceability', {
                params: { lat: lat.toString(), long: lng.toString(), zipcode: zip },
            });
            setServiceability(res.data?.data?.zone_id ? 'yes' : 'no');
        } catch {
            setServiceability('no');
        }
    };

    // Handle marker drag end
    const handleDragEnd = useCallback(
        (e: google.maps.MapMouseEvent) => {
            if (e.latLng) {
                const newPos = { lat: e.latLng.lat(), lng: e.latLng.lng() };
                setPosition(newPos);
                reverseGeocode(newPos.lat, newPos.lng);
            }
        },
        [reverseGeocode]
    );

    // Handle map click
    const handleMapClick = useCallback(
        (e: google.maps.MapMouseEvent) => {
            if (e.latLng) {
                const newPos = { lat: e.latLng.lat(), lng: e.latLng.lng() };
                setPosition(newPos);
                map?.panTo(newPos);
                reverseGeocode(newPos.lat, newPos.lng);
            }
        },
        [reverseGeocode, map]
    );

    // Use browser geolocation
    const handleUseMyLocation = () => {
        if (!navigator.geolocation) {
            alert('Geolocation is not supported by your browser');
            return;
        }
        setLocating(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const newPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                setPosition(newPos);
                map?.panTo(newPos);
                map?.setZoom(17);
                reverseGeocode(newPos.lat, newPos.lng);
                setLocating(false);
            },
            (err) => {
                console.error('Geolocation error:', err);
                alert('Could not get your location. Please allow location access or search manually.');
                setLocating(false);
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    };

    // Confirm selection
    const handleConfirm = () => {
        onLocationSelect({
            lat: position.lat.toString(),
            lng: position.lng.toString(),
            formattedAddress: address,
            city,
            pincode,
        });
    };

    return (
        <div className="space-y-3">
            {/* Search + Use My Location */}
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        ref={searchInputRef}
                        type="text"
                        placeholder="Search for area, street name..."
                        className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-300 focus:border-purple-400 outline-none transition-all"
                    />
                </div>
                <button
                    type="button"
                    onClick={handleUseMyLocation}
                    disabled={locating}
                    className="flex items-center gap-1.5 px-3 py-2.5 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg text-xs font-medium hover:bg-purple-100 transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                    {locating ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                        <Navigation className="w-3.5 h-3.5" />
                    )}
                    {locating ? 'Locating...' : 'Use my location'}
                </button>
            </div>

            {/* Map */}
            <div className="rounded-xl overflow-hidden border border-gray-200 shadow-sm" style={{ height }}>
                <Map
                    mapId="DEMO_MAP_ID"
                    defaultCenter={position}
                    defaultZoom={DEFAULT_ZOOM}
                    gestureHandling="greedy"
                    disableDefaultUI={true}
                    zoomControl={true}
                    clickableIcons={false}
                    onClick={handleMapClick as any}
                    style={{ width: '100%', height: '100%' }}
                >
                    <AdvancedMarker
                        position={position}
                        draggable={true}
                        onDragEnd={handleDragEnd as any}
                    >
                        <div className="flex flex-col items-center">
                            <div className="bg-purple-600 text-white p-1.5 rounded-full shadow-lg">
                                <MapPin className="w-5 h-5" />
                            </div>
                            <div className="w-2 h-2 bg-purple-600 rotate-45 -mt-1.5" />
                        </div>
                    </AdvancedMarker>
                </Map>
            </div>

            {/* Location Details */}
            {address && (
                <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                    <div className="flex items-start gap-2">
                        <MapPin className="w-4 h-4 text-purple-600 mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-800 leading-snug">{address}</p>
                            {(city || pincode) && (
                                <p className="text-xs text-gray-500 mt-1">
                                    {city}{city && pincode ? ' — ' : ''}{pincode}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Serviceability indicator */}
                    {serviceability && (
                        <div className={`mt-2 flex items-center gap-1.5 text-xs font-medium ${
                            serviceability === 'checking' ? 'text-gray-500' :
                            serviceability === 'yes' ? 'text-green-600' : 'text-red-500'
                        }`}>
                            {serviceability === 'checking' && <Loader2 className="w-3 h-3 animate-spin" />}
                            {serviceability === 'yes' && <CheckCircle2 className="w-3.5 h-3.5" />}
                            {serviceability === 'no' && <XCircle className="w-3.5 h-3.5" />}
                            {serviceability === 'checking' && 'Checking serviceability...'}
                            {serviceability === 'yes' && 'This location is serviceable ✓'}
                            {serviceability === 'no' && 'This location may not be serviceable. Try adjusting the pin.'}
                        </div>
                    )}
                </div>
            )}

            {/* Confirm button */}
            {showConfirm && (
                <button
                    type="button"
                    onClick={handleConfirm}
                    disabled={!address || !pincode}
                    className="w-full py-2.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                    <CheckCircle2 className="w-4 h-4" />
                    Confirm Location
                </button>
            )}
        </div>
    );
}
