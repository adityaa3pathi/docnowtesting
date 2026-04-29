require('dotenv').config({ path: '/home/rajanni/Desktop/DOCNOW/server/.env' });
const axios = require('axios');

const HEALTHIANS_BASE_URL = process.env.HEALTHIANS_BASE_URL;
const PARTNER_NAME = process.env.HEALTHIANS_PARTNER_NAME;
const username = process.env.HEALTHIANS_CLIENT_ID;
const password = process.env.HEALTHIANS_CLIENT_SECRET;

const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
console.log(`[Healthians] Authenticating with ${HEALTHIANS_BASE_URL}/${PARTNER_NAME}/getAccessToken`);

axios.get(`${HEALTHIANS_BASE_URL}/${PARTNER_NAME}/getAccessToken`, {
    headers: {
        Authorization: authHeader,
        'User-Agent': 'DOCNOW-Server/1.0',
        'Accept': 'application/json'
    }
}).then(res => {
    console.log("Success:", res.data);
}).catch(err => {
    console.error("Error Message:", err.message);
    if (err.response) {
        console.error("Response Status:", err.response.status);
        console.error("Response Data:", err.response.data);
    }
});
