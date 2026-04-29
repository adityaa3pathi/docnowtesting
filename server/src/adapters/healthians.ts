import axios, { AxiosInstance } from 'axios';
import { generateChecksum } from '../utils/security';


// Re-evaluate the env inside methods rather than module-scope to fix dotenv initialization races
// Removed module-level constants

interface AccessTokenResponse {
    access_token: string;
    token_type: string;
    expires_in: number;
}

export class HealthiansAdapter {
    private static instance: HealthiansAdapter;
    private client: AxiosInstance;
    private accessToken: string | null = null;
    private tokenExpiry: number | null = null;

    private constructor() {
        const baseUrl = process.env.HEALTHIANS_BASE_URL || 'https://t25crm.healthians.co.in/api';
        const partnerName = process.env.HEALTHIANS_PARTNER_NAME || 'docnow1';
        
        const axiosConfig: any = {
            baseURL: `${baseUrl}/${partnerName}`,
            timeout: parseInt(process.env.HEALTHIANS_TIMEOUT_MS || '15000', 10),
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'DOCNOW-Server/1.0'
            },
        };

        this.client = axios.create(axiosConfig);

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

    public static getInstance(): HealthiansAdapter {
        if (!HealthiansAdapter.instance) {
            HealthiansAdapter.instance = new HealthiansAdapter();
        }
        return HealthiansAdapter.instance;
    }

    /**
     * authenticates with Healthians and caches the token.
     */
    private async ensureAuthenticated(): Promise<void> {
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

            const baseUrl = process.env.HEALTHIANS_BASE_URL || 'https://t25crm.healthians.co.in/api';
            const partnerName = process.env.HEALTHIANS_PARTNER_NAME || 'docnow1';

            const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
            console.log(`[Healthians] Authenticating with ${baseUrl}/${partnerName}/getAccessToken`);

            const response = await this.client.get<AccessTokenResponse>('/getAccessToken', {
                headers: {
                    Authorization: authHeader,
                    'User-Agent': 'DOCNOW-Server/1.0',
                    'Accept': 'application/json'
                }
            });

            console.log('Healthians Auth Response Status:', response.status);

            if (response.data.access_token) {
                this.accessToken = response.data.access_token;
                this.tokenExpiry = now + response.data.expires_in;
                console.log('Healthians Access Token Refreshed');
            } else {
                throw new Error('Failed to retrieve access token');
            }
        } catch (error: any) {
            console.error('Healthians Auth Error:', error.response?.status, error.response?.statusText);
            if (error.response?.status === 403) {
                console.error('NOTE: 403 Forbidden likely means IP address is not whitelisted by Healthians or WAF blocking.');
            }
            throw error;
        }
    }

    // --- Location & Serviceability ---

    /**
     * Check if a location is serviceable.
     */
    public async checkServiceability(lat: string, long: string, zipcode: string) {
        try {
            const response = await this.client.post('/checkServiceabilityByLocation_v2', {
                lat,
                long,
                zipcode,
                is_ppmc_booking: 0,
            });
            return response.data;
        } catch (error) {
            console.error('checkServiceability Error:', error);
            throw error;
        }
    }

    /**
     * Get ALL Partner Products for a Zipcode.
     * Fetches each product_type (package, profile, parameter) separately
     * since the API only returns one type at a time. Each type is paginated
     * using a `start` cursor (10 items/page), stopping when data_count === 0.
     */
    public async getPartnerProducts(zipcode: string) {
        const PAGE_SIZE = 10;
        const PRODUCT_TYPES = ['package', 'profile', 'parameter'];
        const allProducts: any[] = [];

        try {
            for (const product_type of PRODUCT_TYPES) {
                let start = 0;
                console.log(`[Healthians] Fetching product_type=${product_type} for zipcode=${zipcode}`);

                while (true) {
                    const response = await this.client.post('/getPartnerProducts', {
                        zipcode,
                        product_type,
                        start
                    });

                    const page = response.data;
                    const items: any[] = page?.data || [];
                    const dataCount: number = page?.data_count ?? items.length;

                    console.log(`[Healthians] product_type=${product_type} start=${start}: ${dataCount} items`);

                    if (dataCount === 0 || items.length === 0) {
                        break;
                    }

                    allProducts.push(...items);
                    start += PAGE_SIZE;

                    // Safety cap — avoid infinite loops
                    if (start > 50000) {
                        console.warn(`[Healthians] Safety cap hit for product_type=${product_type}`);
                        break;
                    }
                }
            }

            console.log(`[Healthians] getPartnerProducts total fetched: ${allProducts.length} (packages+profiles+parameters)`);
            return { data: allProducts };
        } catch (error) {
            console.error('getPartnerProducts Error:', error);
            throw error;
        }
    }


    /**
     * Get Product Details (Constituents, reporting time, fasting, etc.)
     * @param deal_type "package", "profile", or "parameter"
     * @param deal_type_id The ID of the test unit
     */
    public async getProductDetails(deal_type: string, deal_type_id: string | number) {
        try {
            const response = await this.client.post('/getProductDetails', {
                deal_type,
                deal_type_id: Number(deal_type_id)
            });
            return response.data;
        } catch (error) {
            console.error('getProductDetails Error:', error);
            throw error;
        }
    }

    /**
     * Get Active Zipcodes (Can be heavy, maybe cache this)
     */
    public async getActiveZipcodes() {
        try {
            const response = await this.client.get('/getActiveZipcodes');
            return response.data;
        } catch (error) {
            console.error('getActiveZipcodes Error:', error);
            throw error;
        }
    }
    /**
     * Get available slots by location.
     */
    public async getSlotsByLocation(params: {
        lat: string;
        long: string;
        zipcode: string;
        zone_id: string;
        slot_date: string;
        amount: number;
        package: Array<{ deal_id: string[] }>;
        get_ppmc_slots?: number;
        has_female_patient?: number;
    }) {
        try {
            const response = await this.client.post('/getSlotsByLocation', {
                lat: params.lat,
                long: params.long,
                zipcode: params.zipcode,
                zone_id: params.zone_id,
                slot_date: params.slot_date,
                amount: params.amount,
                package: params.package,
                get_ppmc_slots: params.get_ppmc_slots || 0,
                has_female_patient: params.has_female_patient || 0,
            });
            return response.data;
        } catch (error) {
            console.error('getSlotsByLocation Error:', error);
            throw error;
        }
    }

    /**
     * Freeze a slot.
     */
    /**
     * Freeze a slot.
     */
    public async freezeSlot(slotId: string, vendorBillingUserId: string) {
        try {
            const response = await this.client.post('/freezeSlot_v1', {
                slot_id: slotId,
                vendor_billing_user_id: vendorBillingUserId
            });
            return response.data;
        } catch (error) {
            console.error('freezeSlot Error:', error);
            throw error;
        }
    }

    /**
     * Create Booking V3
     */
    public async createBooking(bookingData: any) {
        try {
            let config: any = {};
            const secretKey = process.env.HEALTHIANS_BOOKING_SECRET_KEY;

            if (secretKey) {
                // Generate checkSum of the stringified payload
                const dataString = JSON.stringify(bookingData);
                const checkSum = generateChecksum(dataString, secretKey);

                console.log('Generating X-Checksum for data string:', dataString);
                console.log('Generated X-Checksum:', checkSum);

                config = {
                    headers: {
                        'X-Checksum': checkSum
                    }
                };
            } else {
                console.warn('HEALTHIANS_BOOKING_SECRET_KEY not set. Sending booking without X-Checksum header.');
            }

            const response = await this.client.post('/createBooking_v3', bookingData, config);
            return response.data;
        } catch (error: any) {
            console.error('createBooking Error:', error.message);
            if (error.response) {
                console.error('Healthians Error Response Data:', JSON.stringify(error.response.data, null, 2));
                console.error('Healthians Error Status:', error.response.status);
            }
            throw error;
        }
    }

    /**
     * Get Booking Status
     */
    public async getBookingStatus(bookingId: string) {
        try {
            const response = await this.client.post('/getBookingStatus', {
                booking_id: bookingId
            });
            return response.data;
        } catch (error) {
            console.error('getBookingStatus Error:', error);
            throw error;
        }
    }

    /**
     * Cancel Booking
     */
    public async cancelBooking(params: {
        booking_id: string;
        vendor_billing_user_id: string;
        vendor_customer_id: string;
        remarks: string;
    }) {
        try {
            const response = await this.client.post('/cancelBooking', params);
            return response.data;
        } catch (error) {
            console.error('cancelBooking Error:', error);
            throw error;
        }
    }

    /**
     * Get Phlebo Mask Number
     */
    public async getPhleboMaskNumber(bookingId: string) {
        try {
            const response = await this.client.post('/getPhleboMaskNumber', {
                booking_id: bookingId
            });
            return response.data;
        } catch (error) {
            console.error('getPhleboMaskNumber Error:', error);
            throw error;
        }
    }

    /**
     * Reschedule Booking
     */
    public async rescheduleBooking(params: {
        booking_id: string;
        slot: { slot_id: string };
        customers: { vendor_customer_id: string }[];
        reschedule_reason: string;
    }) {
        try {
            const secretKey = process.env.HEALTHIANS_BOOKING_SECRET_KEY;
            let config = {};

            if (secretKey) {
                const dataString = JSON.stringify(params);
                const checkSum = generateChecksum(dataString, secretKey);
                config = {
                    headers: {
                        'X-Checksum': checkSum
                    }
                };
            }

            const response = await this.client.post('/rescheduleBookingByCustomer_v1', params, config);
            return response.data;
        } catch (error: any) {
            console.error('rescheduleBooking Error:', error.message);
            if (error.response) {
                console.error('Healthians rescheduleBooking Error Response Data:', JSON.stringify(error.response.data, null, 2));
            }
            throw error;
        }
    }

    /**
     * Get Customer Report (v2)
     * Fetches a fresh signed S3 URL for a customer's report.
     * Used as fallback when the webhook-provided URL has expired.
     *
     * @param allow_partial_report - 1 to get partial reports, 0 for full only
     */
    public async getCustomerReport(params: {
        booking_id: string;
        vendor_billing_user_id: string;
        vendor_customer_id: string;
        allow_partial_report: number;
    }) {
        try {
            const response = await this.client.post('/getCustomerReport_v2', params);
            return response.data;
        } catch (error: any) {
            console.error('getCustomerReport Error:', error.message);
            if (error.response) {
                console.error('Healthians getCustomerReport Error Response:', JSON.stringify(error.response.data, null, 2));
            }
            throw error;
        }
    }
}

export const MOCK_PRODUCTS = [
    { id: '1', name: 'Full Body Health Checkup', deal_type: 'package', deal_type_id: '101', price: 1499, description: 'Comprehensive wellness screening including 60+ parameters.' },
    { id: '2', name: 'Vitamin D Screening', deal_type: 'parameter', deal_type_id: '202', price: 499, description: 'Check your Vitamin D levels with a simple blood test.' },
    { id: '3', name: 'Thyroid Profile (Total)', deal_type: 'profile', deal_type_id: '303', price: 599, description: 'T3, T4, and TSH levels check.' },
    { id: '4', name: 'Diabetes Screening', deal_type: 'profile', deal_type_id: '404', price: 299, description: 'HbA1c and Blood Sugar levels.' },
    { id: '5', name: 'Complete Blood Count (CBC)', deal_type: 'parameter', deal_type_id: '505', price: 350, description: 'Basic screening for infection, anemia, and other conditions.' },
    { id: '6', name: 'Liver Function Test', deal_type: 'profile', deal_type_id: '606', price: 800, description: 'Protein, Enzyme, and Bilirubin levels check.' },
];
