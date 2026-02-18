import express, { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { z } from 'zod';

const router = express.Router();
const prisma = new PrismaClient();

const ALLOWED_RELATIONS = ['Spouse', 'Child', 'Parent', 'Grand parent', 'Sibling', 'Friend', 'Native', 'Neighbour', 'Colleague', 'Others'] as const;

const patientSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    relation: z.enum(ALLOWED_RELATIONS, { message: `Relation must be one of: ${ALLOWED_RELATIONS.join(', ')}` }),
    age: z.number().int().min(5, 'Family member must be at least 5 years old').max(150, 'Invalid age'),
    gender: z.enum(['Male', 'Female', 'Other'], { message: 'Gender must be Male, Female, or Other' }),
});

// GET /api/profile/patients - Get all family members
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const patients = await prisma.patient.findMany({
            where: { userId: req.userId },
            orderBy: { name: 'asc' }
        });

        res.status(200).json(patients);
    } catch (error) {
        console.error('Get Patients Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST /api/profile/patients - Add new family member
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const data = patientSchema.parse(req.body);

        const patient = await prisma.patient.create({
            data: {
                userId: req.userId!,
                ...data
            }
        });

        res.status(201).json({
            message: 'Family member added successfully',
            patient
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            res.status(400).json({ error: error.issues[0].message });
            return;
        }
        console.error('Create Patient Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// PUT /api/profile/patients/:id - Update family member
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const id = req.params.id as string;
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

        const updateData = patientSchema.parse(req.body);

        const updatedPatient = await prisma.patient.update({
            where: { id },
            data: updateData
        });

        res.status(200).json({
            message: 'Family member updated successfully',
            patient: updatedPatient
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            res.status(400).json({ error: error.issues[0].message });
            return;
        }
        console.error('Update Patient Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// DELETE /api/profile/patients/:id - Remove family member
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const id = req.params.id as string;

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
    } catch (error) {
        console.error('Delete Patient Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

export default router;
