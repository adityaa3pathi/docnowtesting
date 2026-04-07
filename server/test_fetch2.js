const crypto = require('crypto');
require('dotenv').config();

const HEALTHIANS_BASE_URL = process.env.HEALTHIANS_BASE_URL || 'https://t25crm.healthians.co.in/api';
const PARTNER_NAME = process.env.HEALTHIANS_PARTNER_NAME || 'docnow1';
const KEY = process.env.HEALTHIANS_CLIENT_ID;
const SECRET = process.env.HEALTHIANS_CLIENT_SECRET;

async function run() {
    const authHeader = 'Basic ' + Buffer.from(`${KEY}:${SECRET}`).toString('base64');
    
    console.log("Getting token...")
    const authRes = await fetch(`${HEALTHIANS_BASE_URL}/${PARTNER_NAME}/getAccessToken`, {
        method: 'GET',
        headers: {
            'Authorization': authHeader,
            'User-Agent': 'DOCNOW-Server/1.0',
            'Accept': 'application/json'
        }
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
        package: [{ deal_id: ['parameter_13', 'parameter_9'] }],
        get_ppmc_slots: 0,
        has_female_patient: 0
    };
    
    console.log("Checking slots...")
    const res = await fetch(`${HEALTHIANS_BASE_URL}/${PARTNER_NAME}/getSlotsByLocation`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(reqPayload)
    });
    const result = JSON.parse(await res.text());
    console.log("RESULT for 122001 (parameter_13, parameter_9):");
    console.log(JSON.stringify(result, null, 2));
}

run().catch(console.error);
