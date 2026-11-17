import cron from 'node-cron';
import { extendAllDoctorSlots } from '../modules/consultations/doctors.service';
import { logger } from '../utils/logger';

/**
 * Keeps each approved doctor's rolling slot window full.
 * Runs daily at 00:10 IST. Safe to run twice: existing slots are skipped.
 */
export function startSlotGenerator() {
    cron.schedule('10 0 * * *', async () => {
        try {
            const result = await extendAllDoctorSlots();
            logger.info(result, 'slot_generator_done');
        } catch (error) {
            logger.error({ error }, 'slot_generator_failed');
        }
    }, { timezone: 'Asia/Kolkata' });
    logger.info({ schedule: '10 0 * * * IST' }, 'slot_generator_started');
}
