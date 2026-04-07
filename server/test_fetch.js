const crypto = require('crypto');
require('dotenv').config();

const HEALTHIANS_BASE_URL = process.env.HEALTHIANS_BASE_URL || 'https://t25crm.healthians.co.in/api';
const PARTNER_NAME = process.env.HEALTHIANS_PARTNER_NAME || 'docnow1';
const KEY = process.env.HEALTHIANS_API_KEY;
const SECRET = process.env.HEALTHIANS_API_SECRET;

async function run() {
    const authPayload = JSON.stringify({
        grant_type: "client_credentials",
        client_id: KEY,
        client_secret: SECRET
    });
    
    // Generate Checksum
    const checksumStr = `${KEY}|${authPayload}|${SECRET}`;
    const checksum = crypto.createHash('sha256').update(checksumStr).digest('hex');

    const authRes = await fetch(`${HEALTHIANS_BASE_URL}/${PARTNER_NAME}/getAccessToken`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Checksum': checksum
        },
        body: authPayload
    });
    
    const authData = await authRes.json();
    console.log("Auth Data:", authData);
    const token = authData.access_token;
    
    const reqPayload = {
        lat: '0',
        long: '0',
        zipcode: '122001',
        zone_id: '',
        slot_date: new Date().toISOString().split('T')[0],
        amount: 714,
        package: [{ deal_id: ['parameter_13'] }],
        get_ppmc_slots: 0,
        has_female_patient: 0
    };
    
    const reqPayloadStr = JSON.stringify(reqPayload);
    // Note: getSlotsByLocation requires its own checksum in Healthians (some endpoints do, some just Bearer)
    // Actually wait, does it? The adapter only adds Bearer token.
    const res = await fetch(`${HEALTHIANS_BASE_URL}/${PARTNER_NAME}/getSlotsByLocation`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: reqPayloadStr
    });
    const result = await res.text();
    console.log("RESULT for 122001 and parameter_13:");
    console.log(result);
}

run().catch(console.error);
