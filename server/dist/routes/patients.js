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
// GET /api/profile/patients - Get all family members
router.get('/', auth_1.authMiddleware, async (req, res) => {
    try {
        const patients = await prisma.patient.findMany({
            where: { userId: req.userId },
            orderBy: { name: 'asc' }
        });
        res.status(200).json(patients);
    }
    catch (error) {
        console.error('Get Patients Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// POST /api/profile/patients - Add new family member
router.post('/', auth_1.authMiddleware, async (req, res) => {
    try {
        const { name, relation, age, gender } = req.body;
        // Validate required fields
        if (!name || !relation || !age || !gender) {
            res.status(400).json({ error: 'All fields (name, relation, age, gender) are required' });
            return;
        }
        // Validate age
        if (typeof age !== 'number' || age < 0 || age > 150) {
            res.status(400).json({ error: 'Invalid age' });
            return;
        }
        // Validate gender
        if (!['Male', 'Female', 'Other'].includes(gender)) {
            res.status(400).json({ error: 'Gender must be Male, Female, or Other' });
            return;
        }
        // Validate relation
        const allowedRelations = ['Spouse', 'Child', 'Parent', 'Grand parent', 'Sibling', 'friend', 'Native', 'Neighbour', 'Colleague', 'Others'];
        if (!allowedRelations.includes(relation)) {
            res.status(400).json({ error: `Relation must be one of: ${allowedRelations.join(', ')}` });
            return;
        }
        const patient = await prisma.patient.create({
            data: {
                userId: req.userId,
                name,
                relation,
                age,
                gender
            }
        });
        // ... (rest of create logic) ...
        res.status(201).json({
            message: 'Family member added successfully',
            patient
        });
    }
    catch (error) {
        console.error('Create Patient Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// PUT /api/profile/patients/:id - Update family member
router.put('/:id', auth_1.authMiddleware, async (req, res) => {
    try {
        const id = req.params.id;
        const { name, relation, age, gender } = req.body;
        // Check ownership
        const patient = await prisma.patient.findUnique({
            where: { id }
        });
        if (!patient) {
            res.status(404).json({ error: 'Family member not found' });
            return;
        }
        if (patient.userId !== req.userId) {
            res.status(403).json({ error: 'Unauthorized' });
            return;
        }
        // Build update data
        const updateData = {};
        if (name)
            updateData.name = name;
        if (relation) {
            const allowedRelations = ['Spouse', 'Child', 'Parent', 'Grand parent', 'Sibling', 'friend', 'Native', 'Neighbour', 'Colleague', 'Others'];
            if (!allowedRelations.includes(relation)) {
                res.status(400).json({ error: `Relation must be one of: ${allowedRelations.join(', ')}` });
                return;
            }
            updateData.relation = relation;
        }
        if (age !== undefined) {
            if (typeof age !== 'number' || age < 0 || age > 150) {
                res.status(400).json({ error: 'Invalid age' });
                return;
            }
            updateData.age = age;
        }
        if (gender) {
            if (!['Male', 'Female', 'Other'].includes(gender)) {
                res.status(400).json({ error: 'Gender must be Male, Female, or Other' });
                return;
            }
            updateData.gender = gender;
        }
        const updatedPatient = await prisma.patient.update({
            where: { id },
            data: updateData
        });
        res.status(200).json({
            message: 'Family member updated successfully',
            patient: updatedPatient
        });
    }
    catch (error) {
        console.error('Update Patient Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// DELETE /api/profile/patients/:id - Remove family member
router.delete('/:id', auth_1.authMiddleware, async (req, res) => {
    try {
        const id = req.params.id;
        // Check ownership
        const patient = await prisma.patient.findUnique({
            where: { id }
        });
        if (!patient) {
            res.status(404).json({ error: 'Family member not found' });
            return;
        }
        if (patient.userId !== req.userId) {
            res.status(403).json({ error: 'Unauthorized' });
            return;
        }
        await prisma.patient.delete({
            where: { id }
        });
        res.status(200).json({ message: 'Family member removed successfully' });
    }
    catch (error) {
        console.error('Delete Patient Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
exports.default = router;
