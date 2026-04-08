const process = require('process');
require('dotenv').config();
const HEALTHIANS_BASE_URL = process.env.HEALTHIANS_BASE_URL;
const PARTNER_NAME = process.env.HEALTHIANS_PARTNER_NAME;

async function run() {
    const authHeader = 'Basic ' + Buffer.from(`${process.env.HEALTHIANS_CLIENT_ID}:${process.env.HEALTHIANS_CLIENT_SECRET}`).toString('base64');
    const authRes = await fetch(`${HEALTHIANS_BASE_URL}/${PARTNER_NAME}/getAccessToken`, { headers: { 'Authorization': authHeader } });
    const authData = await authRes.json();
    const token = authData.access_token;

    const res = await fetch(`${HEALTHIANS_BASE_URL}/${PARTNER_NAME}/checkServiceabilityByLocation_v2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ lat: '28.4554726', long: '77.0219019', zipcode: '122001' })
    });
    console.log(JSON.stringify(await res.json(), null, 2));
}
run();
