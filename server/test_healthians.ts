import dotenv from 'dotenv';
dotenv.config();
import { HealthiansAdapter } from './src/adapters/healthians';

async function test() {
    const healthians = HealthiansAdapter.getInstance();
    const resp = await healthians.getSlotsByLocation({
        lat: '0',
        long: '0',
        zipcode: '122001',
        zone_id: '',
        slot_date: new Date().toISOString().split('T')[0],
        amount: 714,
        package: [{ deal_id: ['parameter_13'] }]
    });
    console.log("RESPONSE RECEIVED:");
    console.log(resp);
}

test().catch(console.error);
