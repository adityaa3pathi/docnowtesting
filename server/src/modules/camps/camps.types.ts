/**
 * Camp Validation Schemas
 * 
 * Zod schemas for all camp-related request validation.
 * Used in camps.routes.ts and camps.checkout.ts handlers.
 */
import { z } from 'zod';

export const createCampSchema = z.object({
    name: z.string().min(2, 'Camp name is required'),
    description: z.string().optional(),
    location: z.string().min(5, 'Location is required'),
    city: z.string().min(2, 'City is required'),
    pincode: z.string().regex(/^\d{6}$/, 'Invalid pincode'),
    startDate: z.string().datetime({ message: 'Valid start date required' }),
    endDate: z.string().datetime({ message: 'Valid end date required' }),
    price: z.number().positive('Price must be positive'),
    catalogItemIds: z.array(z.string().uuid()).min(1, 'At least one test/package is required'),
});

export const updateCampSchema = createCampSchema.partial().omit({ catalogItemIds: true });

export const updateCampItemsSchema = z.object({
    catalogItemIds: z.array(z.string().uuid()).min(1, 'At least one test/package is required'),
});

export const campCheckoutSchema = z.object({
    campId: z.string().uuid('Invalid camp ID'),
    patientId: z.string().uuid('Invalid patient ID'),
    dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'DOB must be YYYY-MM-DD format'),
    promoCode: z.string().optional(),
    useWallet: z.boolean().optional(),
});

export type CreateCampInput = z.infer<typeof createCampSchema>;
export type UpdateCampInput = z.infer<typeof updateCampSchema>;
export type CampCheckoutInput = z.infer<typeof campCheckoutSchema>;
