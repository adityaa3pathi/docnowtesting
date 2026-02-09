"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma = new client_1.PrismaClient();
const API_URL = 'http://localhost:5000/api';
async function verifyBookingFlow() {
    try {
        console.log('--- Setup: Seeding Test User ---');
        const mobile = '9876543210';
        const password = 'TestPassword@123';
        const hashedPassword = await bcryptjs_1.default.hash(password, 10);
        // upsert user
        const user = await prisma.user.upsert({
            where: { mobile },
            update: { password: hashedPassword, isVerified: true },
            create: {
                mobile,
                password: hashedPassword,
                name: 'Test User',
                age: 30,
                gender: 'Male',
                isVerified: true
            }
        });
        console.log('User Seeded:', user.mobile);
        // 1. Login
        console.log('\n--- 1. Login ---');
        const loginRes = await axios_1.default.post(`${API_URL}/auth/login/password`, {
            mobile,
            password
        });
        const token = loginRes.data.token;
        console.log('Login Success. Token acquired.');
        const authHeaders = { headers: { Authorization: `Bearer ${token}` } };
        // 2. Ensure Address Exists
        console.log('\n--- 2. Manage Address ---');
        // List addresses
        const addrRes = await axios_1.default.get(`${API_URL}/profile/addresses`, authHeaders);
        let addressId = '';
        if (addrRes.data.length === 0) {
            console.log('Creating new address...');
            const newAddr = await axios_1.default.post(`${API_URL}/profile/addresses`, {
                line1: 'Serviceable Address',
                city: 'Gurgaon',
                pincode: '122016' // Known serviceable
            }, authHeaders);
            addressId = newAddr.data.id;
        }
        else {
            addressId = addrRes.data[0].id;
            console.log('Using existing address:', addressId);
        }
        // 3. Add to Cart
        console.log('\n--- 3. Add to Cart ---');
        // Clear cart first
        await axios_1.default.delete(`${API_URL}/cart`, authHeaders).catch(() => { });
        await axios_1.default.post(`${API_URL}/cart/items`, {
            testCode: '1393', // Vitamin D or similar valid code
            testName: 'Vitamin B12',
            price: 500
        }, authHeaders);
        console.log('Item added to cart.');
        // 4. Freeze Slot
        console.log('\n--- 4. Freeze Slot ---');
        // Need to get slots first? No, we can just try to freeze a known valid time or fake it if mock?
        // We are hitting Real Healthians API? Yes.
        // We need a valid slot.
        // Search for slots over next 7 days
        let slotToBook = null;
        let selectedDate = '';
        for (let i = 0; i < 7; i++) {
            const d = new Date();
            d.setDate(d.getDate() + i);
            const dStr = d.toISOString().split('T')[0];
            console.log(`Checking slots for ${dStr}...`);
            try {
                const slotsRes = await axios_1.default.get(`${API_URL}/slots`, {
                    params: {
                        lat: '28.5079338',
                        long: '77.0751538',
                        zipcode: '122016',
                        date: dStr
                    },
                    headers: { Authorization: `Bearer ${token}` }
                });
                const slots = slotsRes.data.data?.slots || [];
                if (slots.length > 0) {
                    slotToBook = slots[0];
                    selectedDate = dStr;
                    console.log(`Found slot on ${dStr}: ${slotToBook.slot_time}`);
                    break;
                }
            }
            catch (e) {
                console.log(`No slots or error on ${dStr}:`, e.response?.data || e.message);
            }
        }
        if (!slotToBook) {
            throw new Error('No slots available for testing in next 7 days.');
        }
        console.log('Freezing slot:', slotToBook.slot_time);
        // Toggle this if we want to actually freeze on Healthians (might fail without real money or strict checks)
        // Note: 'freezeSlot' api is real.
        const freezeRes = await axios_1.default.post(`${API_URL}/slots/freeze`, {
            slot_id: slotToBook.slot_id, // Ensure mapping is correct
            slot_time: slotToBook.slot_time
        }, authHeaders);
        console.log('Slot Frozen.');
        // 5. Checkout (Create Booking)
        console.log('\n--- 5. Create Booking ---');
        const bookingRes = await axios_1.default.post(`${API_URL}/bookings`, {
            slot_id: slotToBook.slot_id,
            slotDate: selectedDate,
            slotTime: slotToBook.slot_time,
            addressId: addressId,
            payment_option: 'prepaid' // or cod
        }, authHeaders);
        const newBookingId = bookingRes.data.local_booking_id;
        console.log('Booking Created! Local ID:', newBookingId);
        console.log('Partner ID:', bookingRes.data.booking_id);
        // 6. List Bookings
        console.log('\n--- 6. List Bookings ---');
        const listRes = await axios_1.default.get(`${API_URL}/bookings`, authHeaders);
        console.log(`Found ${listRes.data.length} bookings.`);
        const found = listRes.data.find((b) => b.id === newBookingId);
        if (!found)
            throw new Error('New booking not found in list!');
        console.log('Verified booking is in list.');
        // 7. Track Status
        console.log('\n--- 7. Track Status ---');
        const statusRes = await axios_1.default.get(`${API_URL}/bookings/${newBookingId}/status`, authHeaders);
        console.log('Status Response:', statusRes.data);
        console.log('\n--- SUCCESS: Full Flow Verified! ---');
    }
    catch (error) {
        console.error('VERIFICATION FAILED:', error.response?.data || error.message);
        process.exit(1);
    }
    finally {
        await prisma.$disconnect();
    }
}
verifyBookingFlow();
