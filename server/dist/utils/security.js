"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateChecksum = void 0;
const crypto_1 = __importDefault(require("crypto"));
/**
 * Generate a checksum using HMAC-SHA256 algorithm.
 * @param {string} data - The data for which the checksum is to be generated.
 * @param {string} key - The secret key used for generating the checksum.
 * @returns {string} The generated checksum.
 */
const generateChecksum = (data, key) => {
    const hmac = crypto_1.default.createHmac('sha256', key);
    hmac.update(data);
    return hmac.digest('hex');
};
exports.generateChecksum = generateChecksum;
