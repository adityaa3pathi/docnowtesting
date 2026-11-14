import { prisma } from '../db';
import { logAlert } from '../utils/logger';

/**
 * Restores promo usage and wallet balance for a booking that will not go ahead
 * (payment failed, checkout abandoned, or the partner booking failed and was refunded).
 */
export async function rollbackInitiatedBooking(booking: any) {
    if (!booking) return;

    try {
        console.log('[Payments] Rolling back booking:', booking.id);

        await prisma.$transaction(async (tx) => {
            // 1. Rollback Promo
            if (booking.promoCodeId) {
                const redemption = await tx.promoRedemption.findUnique({
                    where: { bookingId: booking.id }
                });

                if (redemption) {
                    await tx.promoRedemption.delete({ where: { id: redemption.id } });

                    const updateResult = await tx.promoCode.updateMany({
                        where: { id: booking.promoCodeId, redeemedCount: { gt: 0 } },
                        data: { redeemedCount: { decrement: 1 } }
                    });

                    if (updateResult.count > 0) {
                        console.log('[Payments] Promo usage rolled back');
                    } else {
                        console.warn('[Payments] Rollback Warning: Promo redeemedCount was 0 or ID not found, skipped decrement');
                    }
                }
            }

            // 2. Rollback Wallet
            if (booking.walletAmount > 0 && booking.userId) {
                const existingRefund = await tx.walletLedger.findFirst({
                    where: {
                        referenceId: booking.id,
                        referenceType: 'REFUND'
                    }
                });

                if (!existingRefund) {
                    const userWallet = await tx.wallet.findUnique({ where: { userId: booking.userId } });
                    if (userWallet) {
                        await tx.wallet.update({
                            where: { id: userWallet.id },
                            data: { balance: { increment: booking.walletAmount } }
                        });

                        await tx.walletLedger.create({
                            data: {
                                walletId: userWallet.id,
                                type: 'CREDIT',
                                amount: booking.walletAmount,
                                balanceAfter: userWallet.balance + booking.walletAmount,
                                description: `Refund for booking #${booking.id.slice(0, 8)}`,
                                referenceType: 'REFUND',
                                referenceId: booking.id
                            }
                        });
                        console.log('[Payments] Wallet refunded');
                    }
                }
            }
        });
    } catch (error) {
        // The user is owed this money; a console line nobody reads is not enough.
        logAlert('wallet_promo_rollback_failed', { error, bookingId: booking.id });
    }
}
