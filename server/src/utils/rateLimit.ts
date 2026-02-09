import { Redis } from '@upstash/redis';
import dotenv from 'dotenv';
dotenv.config();

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

export const redis = (redisUrl && redisToken)
    ? new Redis({ url: redisUrl, token: redisToken })
    : null;

if (!redis) {
    console.warn('UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN missing. Rate limiting is disabled.');
}
