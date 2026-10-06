/**
 * Runs before every test file, ahead of any import. Blank credentials mean no test can reach
 * Razorpay or Upstash with real keys from .env, because dotenv never overrides a set variable.
 */
for (const key of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
    process.env[key] = '';
}
