
import crypto from 'crypto';

/**
 * Generate a checksum using HMAC-SHA256 algorithm.
 * @param {string} data - The data for which the checksum is to be generated.
 * @param {string} key - The secret key used for generating the checksum.
 * @returns {string} The generated checksum.
 */
export const generateChecksum = (data: string, key: string): string => {
    const hmac = crypto.createHmac('sha256', key);
    hmac.update(data);
    return hmac.digest('hex');
};
