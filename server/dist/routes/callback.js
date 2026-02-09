"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
// POST /api/callback/request
router.post('/request', async (req, res) => {
    try {
        const { name, mobile, city } = req.body;
        if (!name || !mobile) {
            res.status(400).json({ error: 'Name and Mobile number are required' });
            return;
        }
        const callbackRequest = await prisma.callbackRequest.create({
            data: {
                name,
                mobile,
                city: city || 'Unspecified',
                status: 'PENDING'
            }
        });
        // TODO: Send WhatsApp notification to Admin here
        res.status(201).json({
            message: 'Callback request received successfully',
            data: callbackRequest
        });
    }
    catch (error) {
        console.error('Error creating callback request:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
exports.default = router;
