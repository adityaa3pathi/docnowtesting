"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGeodataFromPincode = getGeodataFromPincode;
const axios_1 = __importDefault(require("axios"));
/**
 * Fetches latitude, longitude, and city name for an Indian pincode using Google Maps Geocoding API.
 * More precise than Zippopotam but requires API key with billing enabled.
 */
async function getGeodataFromPincode(pincode) {
    try {
        const apiKey = process.env.GOOGLE_MAPS_API_KEY;
        if (!apiKey) {
            console.error('GOOGLE_MAPS_API_KEY is not set in environment variables');
            return null;
        }
        // Google Maps Geocoding API endpoint
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${pincode},India&key=${apiKey}`;
        const response = await axios_1.default.get(url);
        if (response.data.status === 'OK' && response.data.results && response.data.results.length > 0) {
            const result = response.data.results[0];
            const location = result.geometry.location;
            // Extract city from address components
            let city = '';
            const addressComponents = result.address_components || [];
            // Try to find locality or administrative_area_level_2 (district/city)
            for (const component of addressComponents) {
                if (component.types.includes('locality')) {
                    city = component.long_name;
                    break;
                }
                else if (component.types.includes('administrative_area_level_2')) {
                    city = component.long_name;
                }
            }
            // Fallback to formatted_address if no city found
            if (!city && result.formatted_address) {
                const parts = result.formatted_address.split(',');
                city = parts[1]?.trim() || parts[0]?.trim() || 'Unknown';
            }
            return {
                lat: location.lat.toString(),
                long: location.lng.toString(),
                city: city
            };
        }
        console.error('Google Maps API returned no results for pincode:', pincode);
        return null;
    }
    catch (error) {
        console.error('Geocoding Error:', error);
        return null;
    }
}
