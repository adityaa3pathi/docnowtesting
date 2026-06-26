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

// ─── Prediction type for our custom dropdown ────────────────────────────────

interface PredictionItem {
    id: string;
    mainText: string;
    secondaryText: string;
    description: string;
    /** For new API: the suggestion object to call toPlace() on */
    _suggestion?: any;
    /** For legacy API: placeId to call getDetails() */
    _placeId?: string;
}

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

    // Search state
    const [searchQuery, setSearchQuery] = useState('');
    const [predictions, setPredictions] = useState<PredictionItem[]>([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const [searching, setSearching] = useState(false);

    const geocoderRef = useRef<google.maps.Geocoder | null>(null);
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const sessionTokenRef = useRef<any>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const isDraggingRef = useRef(false);
    // Track which API variant is available: 'new' | 'legacy' | null
    const apiVariantRef = useRef<'new' | 'legacy' | null>(null);
    // Legacy PlacesService (needs map)
    const legacyServiceRef = useRef<google.maps.places.PlacesService | null>(null);
    const legacyAutocompleteRef = useRef<google.maps.places.AutocompleteService | null>(null);

    // Initialize geocoder
    useEffect(() => {
        if (geocodingLib) {
            geocoderRef.current = new geocodingLib.Geocoder();
        }
    }, [geocodingLib]);

    // Detect which Places API variant is available and initialize
    useEffect(() => {
        if (!placesLib) return;

        // Check if new API is available (AutocompleteSuggestion exists)
        if ((placesLib as any).AutocompleteSuggestion) {
            apiVariantRef.current = 'new';
            // Create a session token for the new API
            if ((placesLib as any).AutocompleteSessionToken) {
                sessionTokenRef.current = new (placesLib as any).AutocompleteSessionToken();
            }
            console.log('[LocationPicker] Using Places API (New)');
        } else if (placesLib.AutocompleteService) {
            apiVariantRef.current = 'legacy';
            legacyAutocompleteRef.current = new placesLib.AutocompleteService();
            console.log('[LocationPicker] Using legacy Places API');
        } else {
            console.warn('[LocationPicker] No Places API variant available');
        }
    }, [placesLib]);

    // Legacy PlacesService needs the map instance
    useEffect(() => {
        if (!placesLib || !map || apiVariantRef.current !== 'legacy') return;
        legacyServiceRef.current = new placesLib.PlacesService(map);
    }, [placesLib, map]);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setShowDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // ─── Search (supports both API variants) ────────────────────────────────

    const handleSearchChange = (value: string) => {
        setSearchQuery(value);
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

        if (value.trim().length < 3) {
            setPredictions([]);
            setShowDropdown(false);
            return;
        }

        setSearching(true);
        searchTimeoutRef.current = setTimeout(() => {
            if (apiVariantRef.current === 'new') {
                searchWithNewApi(value);
            } else if (apiVariantRef.current === 'legacy') {
                searchWithLegacyApi(value);
            } else {
                setSearching(false);
            }
        }, 300);
    };

    // New Places API: AutocompleteSuggestion.fetchAutocompleteSuggestions
    const searchWithNewApi = async (input: string) => {
        try {
            const AutocompleteSuggestion = (placesLib as any).AutocompleteSuggestion;
            const request: any = {
                input,
                includedRegionCodes: ['IN'],
            };
            if (sessionTokenRef.current) {
                request.sessionToken = sessionTokenRef.current;
            }

            const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions(request);

            const items: PredictionItem[] = (suggestions || []).map((s: any, i: number) => {
                const pp = s.placePrediction;
                return {
                    id: pp?.placeId || `suggestion-${i}`,
                    mainText: pp?.mainText?.text || pp?.text?.text || '',
                    secondaryText: pp?.secondaryText?.text || '',
                    description: pp?.text?.text || '',
                    _suggestion: s,
                };
            });

            setPredictions(items);
            setShowDropdown(items.length > 0);
        } catch (err) {
            console.error('[LocationPicker] New API search error:', err);
            setPredictions([]);
        } finally {
            setSearching(false);
        }
    };

    // Legacy Places API: AutocompleteService.getPlacePredictions
    const searchWithLegacyApi = (input: string) => {
        if (!legacyAutocompleteRef.current) { setSearching(false); return; }

        legacyAutocompleteRef.current.getPlacePredictions(
            { input, componentRestrictions: { country: 'in' } },
            (results, status) => {
                setSearching(false);
                if (status === google.maps.places.PlacesServiceStatus.OK && results) {
                    const items: PredictionItem[] = results.map((r) => ({
                        id: r.place_id,
                        mainText: r.structured_formatting.main_text,
                        secondaryText: r.structured_formatting.secondary_text,
                        description: r.description,
                        _placeId: r.place_id,
                    }));
                    setPredictions(items);
                    setShowDropdown(items.length > 0);
                } else {
                    setPredictions([]);
                }
            }
        );
    };

    // ─── Handle prediction selection ────────────────────────────────────────

    const handleSelectPrediction = async (item: PredictionItem) => {
        setSearchQuery(item.description);
        setShowDropdown(false);
        setPredictions([]);

        if (apiVariantRef.current === 'new' && item._suggestion) {
            // New API: use toPlace() + fetchFields()
            try {
                const place = item._suggestion.placePrediction.toPlace();
                await place.fetchFields({ fields: ['location', 'formattedAddress', 'addressComponents'] });

                if (place.location) {
                    const lat = typeof place.location.lat === 'function' ? place.location.lat() : place.location.lat;
                    const lng = typeof place.location.lng === 'function' ? place.location.lng() : place.location.lng;
                    const newPos = { lat, lng };
                    setPosition(newPos);
                    map?.panTo(newPos);
                    map?.setZoom(17);

                    // Map addressComponents to the format extractAddressComponents expects
                    const comps = place.addressComponents?.map((c: any) => ({
                        long_name: c.longText || c.long_name || '',
                        short_name: c.shortText || c.short_name || '',
                        types: c.types || [],
                    }));
                    extractAddressComponents(comps, place.formattedAddress);
                }

                // Refresh session token after a selection
                if ((placesLib as any).AutocompleteSessionToken) {
                    sessionTokenRef.current = new (placesLib as any).AutocompleteSessionToken();
                }
            } catch (err) {
                console.error('[LocationPicker] New API place details error:', err);
            }
        } else if (apiVariantRef.current === 'legacy' && item._placeId && legacyServiceRef.current) {
            // Legacy API: PlacesService.getDetails()
            legacyServiceRef.current.getDetails(
                { placeId: item._placeId, fields: ['geometry', 'formatted_address', 'address_components'] },
                (place, status) => {
                    if (status === google.maps.places.PlacesServiceStatus.OK && place?.geometry?.location) {
                        const newPos = {
                            lat: place.geometry.location.lat(),
                            lng: place.geometry.location.lng(),
                        };
                        setPosition(newPos);
                        map?.panTo(newPos);
                        map?.setZoom(17);
                        extractAddressComponents(place.address_components, place.formatted_address);
                    }
                }
            );
        }
    };

    // ─── Geocoding & address helpers ────────────────────────────────────────

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

    // ─── Map interaction handlers ───────────────────────────────────────────

    const handleDragStart = useCallback(() => {
        isDraggingRef.current = true;
    }, []);

    const handleDragEnd = useCallback(
        (e: any) => {
            setTimeout(() => { isDraggingRef.current = false; }, 100);

            let lat, lng;
            if (e.latLng) {
                lat = typeof e.latLng.lat === 'function' ? e.latLng.lat() : e.latLng.lat;
                lng = typeof e.latLng.lng === 'function' ? e.latLng.lng() : e.latLng.lng;
            } else if (e.target && e.target.position) {
                lat = e.target.position.lat;
                lng = e.target.position.lng;
            }

            if (lat !== undefined && lng !== undefined) {
                const newPos = { lat, lng };
                setPosition(newPos);
                reverseGeocode(lat, lng);
            }
        },
        [reverseGeocode]
    );

    const handleMapClick = useCallback(
        (e: any) => {
            if (isDraggingRef.current) return;

            let lat, lng;
            if (e.detail?.latLng) {
                lat = e.detail.latLng.lat;
                lng = e.detail.latLng.lng;
            } else if (e.latLng) {
                lat = typeof e.latLng.lat === 'function' ? e.latLng.lat() : e.latLng.lat;
                lng = typeof e.latLng.lng === 'function' ? e.latLng.lng() : e.latLng.lng;
            }

            if (lat !== undefined && lng !== undefined) {
                const newPos = { lat, lng };
                setPosition(newPos);
                map?.panTo(newPos);
                reverseGeocode(lat, lng);
            }
        },
        [reverseGeocode, map]
    );

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

    const handleConfirm = () => {
        onLocationSelect({
            lat: position.lat.toString(),
            lng: position.lng.toString(),
            formattedAddress: address,
            city,
            pincode,
        });
    };

    // ─── Render ─────────────────────────────────────────────────────────────

    return (
        <div className="space-y-3">
            {/* Search + Use My Location */}
            <div className="flex gap-2">
                <div className="relative flex-1" ref={dropdownRef}>
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none z-10" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        onFocus={() => predictions.length > 0 && setShowDropdown(true)}
                        placeholder="Search for area, street name..."
                        className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-300 focus:border-purple-400 outline-none transition-all bg-white"
                    />
                    {searching && (
                        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />
                    )}

                    {/* Dropdown */}
                    {showDropdown && predictions.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
                            {predictions.map((p) => (
                                <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => handleSelectPrediction(p)}
                                    className="w-full text-left px-3 py-2.5 hover:bg-purple-50 transition-colors border-b border-gray-50 last:border-0 flex items-start gap-2"
                                >
                                    <MapPin className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                                    <div>
                                        <p className="text-sm text-gray-800">{p.mainText}</p>
                                        <p className="text-xs text-gray-500">{p.secondaryText}</p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
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
                        onDragStart={handleDragStart as any}
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
