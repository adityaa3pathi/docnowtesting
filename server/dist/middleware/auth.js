"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_dev_only';
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Authorization token missing' });
        return;
    }
    const token = authHeader.split(' ')[1];
    // Debug: log token format (first 20 chars for safety)
    console.log('[Auth] Token received:', token?.substring(0, 30) + '...');
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        req.userId = decoded.userId;
        next();
    }
    catch (error) {
        console.error('JWT Verification Error:', error);
        console.error('[Auth] Full token was:', token);
        res.status(401).json({ error: 'Invalid or expired token' });
    }
};
exports.authMiddleware = authMiddleware;
