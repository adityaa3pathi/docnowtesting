"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
// GET /api/profile - Get current user's profile
router.get('/', auth_1.authMiddleware, async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.userId },
            select: {
                id: true,
                name: true,
                email: true,
                mobile: true,
                isVerified: true,
                gender: true,
                age: true,
                createdAt: true
            }
        });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        res.status(200).json(user);
    }
    catch (error) {
        console.error('Get Profile Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// PUT /api/profile - Update user profile
router.put('/', auth_1.authMiddleware, async (req, res) => {
    try {
        const { name, email, gender, age } = req.body;
        // Validate at least one field is provided
        if (!name && !email && !gender && !age) {
            res.status(400).json({ error: 'At least one field to update is required' });
            return;
        }
        const updateData = {};
        if (name)
            updateData.name = name;
        if (gender)
            updateData.gender = gender;
        if (age)
            updateData.age = parseInt(age);
        if (email) {
            // Check if email is already taken by another user
            const existingUser = await prisma.user.findUnique({
                where: { email }
            });
            if (existingUser && existingUser.id !== req.userId) {
                res.status(409).json({ error: 'Email already in use' });
                return;
            }
            updateData.email = email;
        }
        const updatedUser = await prisma.user.update({
            where: { id: req.userId },
            data: updateData,
            select: {
                id: true,
                name: true,
                email: true,
                mobile: true,
                gender: true,
                age: true,
                isVerified: true
            }
        });
        res.status(200).json({
            message: 'Profile updated successfully',
            user: updatedUser
        });
    }
    catch (error) {
        console.error('Update Profile Error:', error);
        if (error.code === 'P2025') {
            // Record to update not found - likely due to DB reset while using old token
            res.status(404).json({ error: 'User not found. Please log in again.' });
            return;
        }
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
exports.default = router;
