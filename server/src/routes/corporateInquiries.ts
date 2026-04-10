import express, { Request, Response } from 'express';
import { prisma } from '../db';

const router = express.Router();

const COMPANY_SIZE_OPTIONS = ['1-50', '51-200', '201-1000', '1000+'] as const;
const REQUIREMENT_TYPES = [
    'Employee health checkups',
    'Onsite health camps',
    'Pre-employment testing',
    'Recurring diagnostics partnership',
    'Custom requirement',
] as const;

router.post('/', async (req: Request, res: Response) => {
    try {
        const {
            contactName,
            workEmail,
            mobile,
            companyName,
            city,
            companySize,
            requirementType,
            summary,
        } = req.body as Record<string, string | undefined>;

        if (!contactName?.trim()) {
            return res.status(400).json({ error: 'Contact person name is required' });
        }
        if (!workEmail?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(workEmail.trim())) {
            return res.status(400).json({ error: 'A valid work email is required' });
        }
        if (!mobile?.trim() || !/^[6-9]\d{9}$/.test(mobile.trim())) {
            return res.status(400).json({ error: 'A valid 10-digit mobile number is required' });
        }
        if (!companyName?.trim()) {
            return res.status(400).json({ error: 'Company name is required' });
        }
        if (!city?.trim()) {
            return res.status(400).json({ error: 'City is required' });
        }
        if (!companySize || !COMPANY_SIZE_OPTIONS.includes(companySize as typeof COMPANY_SIZE_OPTIONS[number])) {
            return res.status(400).json({ error: 'Please select a valid company size' });
        }
        if (!requirementType || !REQUIREMENT_TYPES.includes(requirementType as typeof REQUIREMENT_TYPES[number])) {
            return res.status(400).json({ error: 'Please select a valid requirement type' });
        }

        const inquiry = await prisma.corporateInquiry.create({
            data: {
                contactName: contactName.trim(),
                workEmail: workEmail.trim().toLowerCase(),
                mobile: mobile.trim(),
                companyName: companyName.trim(),
                city: city.trim(),
                companySize,
                requirementType,
                summary: summary?.trim() || null,
            },
        });

        res.status(201).json({
            message: 'Thanks, our corporate partnerships team will reach out shortly.',
            data: inquiry,
        });
    } catch (error) {
        console.error('Error creating corporate inquiry:', error);
        res.status(500).json({ error: 'We could not submit your request right now. Please try again shortly.' });
    }
});

export default router;
