import { Router } from 'express';
import { prisma } from '../db';

const router = Router();

// --- USER ---

// Login/Register (Mock for now, should replace with real OTP flow)
router.post('/login', async (req, res) => {
    const { mobile, name, email } = req.body;
    if (!mobile) return res.status(400).json({ error: 'Mobile is required' });

    try {
        let user = await prisma.user.findUnique({ where: { mobile } });

        if (!user) {
            user = await prisma.user.create({
                data: { mobile, name, email },
            });
            // Create "Self" Patient automatically
            await prisma.patient.create({
                data: {
                    userId: user.id,
                    name: name || 'User',
                    relation: 'Self',
                    age: 0, // Default, user needs to update
                    gender: 'U'
                }
            })
        }

        res.json(user);
    } catch (error) {
        res.status(500).json({ error: 'Login failed' });
    }
});

// Update User Profile
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { name, email } = req.body;

    try {
        const user = await prisma.user.update({
            where: { id },
            data: { name, email },
        });
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// --- PATIENTS (FAMILY MEMBERS) ---

// Get all patients for a user
router.get('/:userId/patients', async (req, res) => {
    const { userId } = req.params;
    try {
        const patients = await prisma.patient.findMany({
            where: { userId },
        });
        res.json(patients);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch patients' });
    }
});

// Add a family member
router.post('/:userId/patients', async (req, res) => {
    const { userId } = req.params;
    const { name, relation, age, gender } = req.body;

    try {
        const patient = await prisma.patient.create({
            data: {
                userId,
                name,
                relation,
                age: parseInt(age),
                gender,
            },
        });
        res.json(patient);
    } catch (error) {
        res.status(500).json({ error: 'Failed to add family member' });
    }
});

// Update a family member
router.put('/patients/:patientId', async (req, res) => {
    const { patientId } = req.params;
    const { name, relation, age, gender } = req.body;

    try {
        const patient = await prisma.patient.update({
            where: { id: patientId },
            data: { name, relation, age: parseInt(age), gender },
        });
        res.json(patient);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update family member' });
    }
});

// Delete a family member
router.delete('/patients/:patientId', async (req, res) => {
    const { patientId } = req.params;
    try {
        await prisma.patient.delete({ where: { id: patientId } });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete family member' });
    }
});

export default router;
