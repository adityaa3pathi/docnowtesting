/**
 * Runs before every test file, ahead of any import. Blank credentials mean no test can reach
 * Razorpay, Upstash or LiveKit with real keys from .env, because dotenv never overrides a set variable.
 */
for (const key of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']) {
    process.env[key] = '';
}

// No test may send a real push through Expo; suites that test pushes inject their own sender.
process.env.EXPO_PUSH_DISABLED = '1';
process.env.EXPO_ACCESS_TOKEN = '';

// App code reads DATABASE_URL; point it at the test database, or at nothing, never at the .env one.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://no-db@127.0.0.1:1/no_test_db';
