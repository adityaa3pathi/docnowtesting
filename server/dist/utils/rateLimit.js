"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redis = void 0;
const redis_1 = require("@upstash/redis");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
exports.redis = (redisUrl && redisToken)
    ? new redis_1.Redis({ url: redisUrl, token: redisToken })
    : null;
if (!exports.redis) {
    console.warn('UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN missing. Rate limiting is disabled.');
}
