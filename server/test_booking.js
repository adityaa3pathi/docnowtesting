const crypto = require('crypto');
require('dotenv').config();

const HEALTHIANS_BASE_URL = process.env.HEALTHIANS_BASE_URL;
const PARTNER_NAME = process.env.HEALTHIANS_PARTNER_NAME;
const KEY = process.env.HEALTHIANS_CLIENT_ID;
const SECRET = process.env.HEALTHIANS_CLIENT_SECRET;
const BOOKING_SECRET = process.env.HEALTHIANS_BOOKING_SECRET_KEY;
function generateChecksum(dataString, secretKey) { return crypto.createHmac('sha256', secretKey).update(dataString).digest('hex'); }

async function run() {
    const authHeader = 'Basic ' + Buffer.from(`${KEY}:${SECRET}`).toString('base64');
    const authRes = await fetch(`${HEALTHIANS_BASE_URL}/${PARTNER_NAME}/getAccessToken`, { headers: { 'Authorization': authHeader } });
    const token = (await authRes.json()).access_token;

    const slotsPayload = { lat: '28.4595', long: '77.0266', zipcode: '122001', zone_id: '53', slot_date: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0], amount: 400, package: [{ deal_id: ['parameter_5']}], get_ppmc_slots: 0, has_female_patient: 0 };
    const slotsRes = await fetch(`${HEALTHIANS_BASE_URL}/${PARTNER_NAME}/getSlotsByLocation`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(slotsPayload) });
    const slotsData = await slotsRes.json();
    const slotId = slotsData.data[0].stm_id;
    const freezeRes = await fetch(`${HEALTHIANS_BASE_URL}/${PARTNER_NAME}/freezeSlot_v1`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ slot_id: slotId, vendor_billing_user_id: "test1234" }) });
    const frozenSlotId = (await freezeRes.json()).data?.slot_id || slotId;
    const bookingPayload = {
        customer: [{ customer_id: "CUYEFNRUQB343B", customer_name: "RAHUL SHARMA", relation: "self", age: 31, dob: "05/07/1994", gender: "M", contact_number: "8377736411", email: "", customer_remarks: "PPMC customer remark" }],
        slot: { slot_id: `${frozenSlotId}` }, package: [{ deal_id: ["parameter_5"] }], customer_calling_number: "8377736411", billing_cust_name: "RAHUL SHARMA", gender: "M", mobile: "8377736411", billing_gender: "M", billing_mobile: "8377736411", email: "rahulsharma@gmail.com",
        state: 26, cityId: 23, sub_locality: "Plot No-518, Phase III, Udyog Vihar III, Sector 19, Gurugram, Haryana 122001, India",
        latitude: "28.4595", longitude: "77.0266", address: "Sector 19", zipcode: "122001", landmark: "Near Toll", altmobile: "9877823482", altemail: "rahul.sh201@gmail.com", hard_copy: 0, vendor_booking_id: "8972348" + Date.now(), vendor_billing_user_id: "CUYEFNRUQB343B", payment_option: "prepaid", discounted_price: 400, zone_id: 53, client_id: "", is_ppmc_booking: 0
    };
    const dataString = JSON.stringify(bookingPayload);
    const checksum = generateChecksum(dataString, BOOKING_SECRET);
    const bookRes = await fetch(`${HEALTHIANS_BASE_URL}/${PARTNER_NAME}/createBooking_v3`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'X-Checksum': checksum }, body: dataString });
    console.log("Response:", await bookRes.text());
}
run();
