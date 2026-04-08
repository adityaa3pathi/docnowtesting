require('dotenv').config();
const HEALTHIANS_BASE_URL = process.env.HEALTHIANS_BASE_URL;
const PARTNER_NAME = process.env.HEALTHIANS_PARTNER_NAME;

async function run() {
    const authHeader = 'Basic ' + Buffer.from(`${process.env.HEALTHIANS_CLIENT_ID}:${process.env.HEALTHIANS_CLIENT_SECRET}`).toString('base64');
    const authRes = await fetch(`${HEALTHIANS_BASE_URL}/${PARTNER_NAME}/getAccessToken`, { headers: { 'Authorization': authHeader } });
    const token = (await authRes.json()).access_token;

    const slotsPayload = { lat: '28.512195944534703', long: '77.08483249142313', zipcode: '122016', zone_id: '53', slot_date: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0], amount: 400, package: [{ deal_id: ['profile_1']}], get_ppmc_slots: 0, has_female_patient: 0 };
    const slotsRes = await fetch(`${HEALTHIANS_BASE_URL}/${PARTNER_NAME}/getSlotsByLocation`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(slotsPayload) });
    console.log(JSON.stringify(await slotsRes.json(), null, 2).substring(0, 500));
}
run();
