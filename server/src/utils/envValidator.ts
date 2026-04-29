export function validateEnv() {
    const requiredEnvVars = [
        'JWT_SECRET',
        'DATABASE_URL',
        'HEALTHIANS_CLIENT_ID',
        'HEALTHIANS_CLIENT_SECRET',
        'HEALTHIANS_BOOKING_SECRET_KEY',
        'HEALTHIANS_WEBHOOK_SECRET',
        'RAZORPAY_KEY_ID',
        'RAZORPAY_KEY_SECRET',
        'RAZORPAY_WEBHOOK_SECRET',
        'AWS_S3_BUCKET',
        'AWS_S3_REGION',
        'AWS_ACCESS_KEY_ID',
        'AWS_SECRET_ACCESS_KEY',
    ];

    const missingVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

    if (missingVars.length > 0) {
        console.error('====================================================');
        console.error('❌  CRITICAL STARTUP ERROR: Missing Environment Variables');
        console.error('====================================================');
        console.error('The following critical variables are not defined in your environment:');
        missingVars.forEach(v => console.error(`   - ${v}`));
        console.error('\nPlease check your .env file or deployment configuration.');
        console.error('Server cannot start safely. Exiting...');
        console.error('====================================================');
        process.exit(1);
    }
}
