import * as dotenv from 'dotenv';
dotenv.config();
import { HealthiansAdapter } from './src/adapters/healthians';

async function run() {
    const adapter = HealthiansAdapter.getInstance();
    
    try {
        console.log('Testing package 94 on staging...');
        const client = (adapter as any).client;
        const res = await client.post('/getProductDetails', {
            deal_type: 'package',
            deal_type_id: 94
        });
        console.log('Package 94 response:', JSON.stringify(res.data, null, 2));
    } catch (err: any) {
        console.error('Error testing package 94:', err.response?.data || err.message);
    }
}

run();
