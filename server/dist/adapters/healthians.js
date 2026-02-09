"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MOCK_PRODUCTS = exports.HealthiansAdapter = void 0;
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const HEALTHIANS_BASE_URL = process.env.HEALTHIANS_BASE_URL || 'https://t25crm.healthians.co.in/api';
const PARTNER_NAME = 'healthians'; // TODO: Confirm if this is needed or if it is part of the URL
class HealthiansAdapter {
    constructor() {
        this.accessToken = null;
        this.tokenExpiry = null;
        this.client = axios_1.default.create({
            baseURL: `${HEALTHIANS_BASE_URL}/${PARTNER_NAME}`,
            headers: {
                'Content-Type': 'application/json',
            },
        });
        // Interceptor to add Bearer token to requests (except auth)
        this.client.interceptors.request.use(async (config) => {
            if (config.url?.includes('getAccessToken')) {
                return config;
            }
            await this.ensureAuthenticated();
            if (this.accessToken) {
                config.headers.Authorization = `Bearer ${this.accessToken}`;
            }
            return config;
        });
    }
    static getInstance() {
        if (!HealthiansAdapter.instance) {
            HealthiansAdapter.instance = new HealthiansAdapter();
        }
        return HealthiansAdapter.instance;
    }
    /**
     * authenticates with Healthians and caches the token.
     */
    async ensureAuthenticated() {
        const now = Math.floor(Date.now() / 1000);
        // Buffer of 60 seconds
        if (this.accessToken && this.tokenExpiry && now < this.tokenExpiry - 60) {
            return;
        }
        try {
            // Basic Auth for Token Endpoint
            const username = process.env.HEALTHIANS_CLIENT_ID;
            const password = process.env.HEALTHIANS_CLIENT_SECRET;
            if (!username || !password) {
                throw new Error("Missing Healthians Credentials");
            }
            const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
            const response = await axios_1.default.get(`${HEALTHIANS_BASE_URL}/${PARTNER_NAME}/getAccessToken`, {
                headers: {
                    Authorization: authHeader
                }
            });
            console.log('Healthians Auth Response Status:', response.status);
            console.log('Healthians Auth Response Data:', response.data);
            if (response.data.access_token) {
                this.accessToken = response.data.access_token;
                this.tokenExpiry = now + response.data.expires_in;
                console.log('Healthians Access Token Refreshed');
            }
            else {
                throw new Error('Failed to retrieve access token');
            }
        }
        catch (error) {
            console.error('Healthians Auth Error:', error);
            throw error;
        }
    }
    // --- Location & Serviceability ---
    /**
     * Check if a location is serviceable.
     */
    async checkServiceability(lat, long, zipcode) {
        try {
            const response = await this.client.post('/checkServiceabilityByLocation_v2', {
                lat,
                long,
                zipcode,
                is_ppmc_booking: 0,
            });
            return response.data;
        }
        catch (error) {
            console.error('checkServiceability Error:', error);
            throw error;
        }
    }
    /**
     * Get Partner Products (Packages/Tests) for a Zipcode
     */
    async getPartnerProducts(zipcode) {
        try {
            const response = await this.client.post('/getPartnerProducts', {
                zipcode
            });
            return response.data;
        }
        catch (error) {
            console.error('getPartnerProducts Error:', error);
            throw error;
        }
    }
    /**
     * Get Active Zipcodes (Can be heavy, maybe cache this)
     */
    async getActiveZipcodes() {
        try {
            const response = await this.client.get('/getActiveZipcodes');
            return response.data;
        }
        catch (error) {
            console.error('getActiveZipcodes Error:', error);
            throw error;
        }
    }
}
exports.HealthiansAdapter = HealthiansAdapter;
exports.MOCK_PRODUCTS = [
    { id: '1', name: 'Full Body Health Checkup', deal_type: 'package', deal_type_id: '101', price: 1499, description: 'Comprehensive wellness screening including 60+ parameters.' },
    { id: '2', name: 'Vitamin D Screening', deal_type: 'parameter', deal_type_id: '202', price: 499, description: 'Check your Vitamin D levels with a simple blood test.' },
    { id: '3', name: 'Thyroid Profile (Total)', deal_type: 'profile', deal_type_id: '303', price: 599, description: 'T3, T4, and TSH levels check.' },
    { id: '4', name: 'Diabetes Screening', deal_type: 'profile', deal_type_id: '404', price: 299, description: 'HbA1c and Blood Sugar levels.' },
    { id: '5', name: 'Complete Blood Count (CBC)', deal_type: 'parameter', deal_type_id: '505', price: 350, description: 'Basic screening for infection, anemia, and other conditions.' },
    { id: '6', name: 'Liver Function Test', deal_type: 'profile', deal_type_id: '606', price: 800, description: 'Protein, Enzyme, and Bilirubin levels check.' },
];
