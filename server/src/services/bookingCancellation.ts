import { ManagerOrderStatus, PaymentStatus } from '@prisma/client';
import { HealthiansAdapter } from '../adapters/healthians';
import { prisma } from '../db';
import { getRazorpay } from './razorpay';
import { BookingService } from './booking.service';
import { assertTransition } from '../utils/paymentStateMachine';
import { retryWithBackoff } from '../utils/helpers';

const healthians = HealthiansAdapter.getInstance();
const PARTNER_CANCELABLE_STATUSES = new Set(['BS002', 'BS005']);
const MANAGER_CANCELABLE_STATUSES = new Set<ManagerOrderStatus>([
    'CREATED',
    'SENT',
    'PAYMENT_RECEIVED',
    'CONFIRMED',
]);

type CancellationActor =
    | {
        type: 'manager';
        userId: string;
        adminId: string;
        adminName: string;
        ipAddress: string;
    }
    | {
        type: 'customer';
        userId: string;
    };

type CancelBookingRecord = {
    id: string;
    status: string;
    paymentStatus: PaymentStatus;
    partnerBookingId: string | null;
    partnerStatus: string | null;
    razorpayPaymentId: string | null;
};

type CancelManagerOrderRecord = {
    id: string;
    status: ManagerOrderStatus;
};

export interface CancellationResult {
    message: string;
    bookingStatus: 'Cancelled';
    paymentStatus: 'CANCELLED' | 'REFUNDED';
    managerOrderStatus?: 'CANCELLED' | 'REFUNDED';
    refundStatus: 'not_applicable' | 'refunded' | 'manual_required';
    manualRefundRequired: boolean;
    partnerCancellation: 'not_required' | 'cancelled';
    successCount?: number;
    failureCount?: number;
    details?: Array<{ customerId: string; status?: string; message?: string; error?: string }>;
}

function isAlreadyCancelled(
    booking: CancelBookingRecord,
    managerOrder?: CancelManagerOrderRecord | null
) {
    return (
        booking.status === 'Cancelled' ||
        booking.paymentStatus === 'CANCELLED' ||
        booking.paymentStatus === 'REFUNDED' ||
        String(managerOrder?.status || '') === 'CANCELLED' ||
        String(managerOrder?.status || '') === 'REFUNDED'
    );
}

function isRealOnlinePayment(paymentId?: string | null) {
    return Boolean(paymentId && !paymentId.startsWith('ZERO_'));
}

function getCancellationMessage(
    partnerCancellation: 'not_required' | 'cancelled',
    refundStatus: 'not_applicable' | 'refunded' | 'manual_required'
) {
    if (refundStatus === 'refunded') {
        return partnerCancellation === 'cancelled'
            ? 'Order cancelled and online refund initiated.'
            : 'Order cancelled and online refund initiated.';
    }

    if (refundStatus === 'manual_required') {
        return partnerCancellation === 'cancelled'
            ? 'Order cancelled, but the online refund must be handled manually.'
            : 'Order cancelled, but the online refund must be handled manually.';
    }

    return partnerCancellation === 'cancelled'
        ? 'Order cancelled successfully.'
        : 'Order cancelled successfully.';
}

async function loadBookingById(bookingId: string, userId: string) {
    return prisma.booking.findFirst({
        where: { id: bookingId, userId },
        include: {
            managerOrder: true,
        },
    });
}

async function loadGlobalBookingById(bookingId: string) {
    return prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
            managerOrder: true,
        },
    });
}

async function loadManagerOrderById(managerOrderId: string, managerId: string) {
    return prisma.managerOrder.findFirst({
        where: { id: managerOrderId, managerId },
        include: {
            booking: true,
        },
    });
}

async function cancelWithPartner(partnerBookingId: string, actorUserId: string, remarks: string) {
    const { customers, bookingStatus } = await BookingService.getHealthiansCustomers(partnerBookingId);

    if (!PARTNER_CANCELABLE_STATUSES.has(bookingStatus || '')) {
        throw new Error(`Cancellation not allowed. Current status is: ${bookingStatus || 'Unknown'}`);
    }

    const cancellableCustomers = customers.filter((customer: any) => customer.customer_status !== 'BS0018');
    if (cancellableCustomers.length === 0) {
        throw new Error('No active customers found to cancel');
    }

    const results: Array<{ customerId: string; status?: string; message?: string; error?: string }> = [];
    const failures: Array<{ customerId: string; error: string }> = [];

    console.log(`[Cancellation] Starting partner cancellation for booking ${partnerBookingId} with ${cancellableCustomers.length} customers`);

    for (const customer of cancellableCustomers) {
        try {
            const cancelRes = await retryWithBackoff(() => healthians.cancelBooking({
                booking_id: partnerBookingId,
                vendor_billing_user_id: actorUserId,
                vendor_customer_id: customer.vendor_customer_id,
                remarks,
            }));

            results.push({
                customerId: customer.vendor_customer_id,
                status: cancelRes.status,
                message: cancelRes.message,
            });
        } catch (error: any) {
            console.error(`[Cancellation] Partner cancel failed for customer ${customer.vendor_customer_id}:`, error.message);
            failures.push({
                customerId: customer.vendor_customer_id,
                error: 'Partner API error',
            });
        }
    }

    if (results.length === 0) {
        const err = new Error('Failed to cancel any customers on the partner platform');
        (err as any).details = failures;
        throw err;
    }

    return {
        successCount: results.length,
        failureCount: failures.length,
        details: [...results, ...failures],
    };
}

async function attemptOnlineRefund(bookingId: string, paymentId: string | null | undefined, remarks: string) {
    if (!isRealOnlinePayment(paymentId)) {
        return { refundStatus: 'not_applicable' as const };
    }

    try {
        await getRazorpay().payments.refund(paymentId!, {
            notes: {
                reason: remarks,
                bookingId,
                source: 'manager_cancellation',
            },
        });
        return { refundStatus: 'refunded' as const };
    } catch (error: any) {
        console.error(`[Cancellation] Refund failed for booking ${bookingId}:`, error.message);
        return {
            refundStatus: 'manual_required' as const,
            refundError: error.message || 'Refund failed',
        };
    }
}

async function applyCancellationUpdates(params: {
    booking: CancelBookingRecord;
    managerOrder?: CancelManagerOrderRecord | null;
    actor: CancellationActor;
    remarks: string;
    paymentStatus: PaymentStatus;
    managerOrderStatus?: ManagerOrderStatus;
    partnerCancellation: 'not_required' | 'cancelled';
    refundStatus: 'not_applicable' | 'refunded' | 'manual_required';
    refundError?: string;
}) {
    const {
        booking,
        managerOrder,
        actor,
        remarks,
        paymentStatus,
        managerOrderStatus,
        partnerCancellation,
        refundStatus,
        refundError,
    } = params;

    assertTransition(booking.paymentStatus, paymentStatus);

    await prisma.$transaction(async (tx) => {
        await tx.booking.update({
            where: { id: booking.id },
            data: {
                status: 'Cancelled',
                paymentStatus,
                partnerStatus: partnerCancellation === 'cancelled' ? 'BS003' : booking.partnerStatus,
                partnerError: remarks,
            },
        });

        if (managerOrder && managerOrderStatus) {
            await tx.managerOrder.update({
                where: { id: managerOrder.id },
                data: {
                    status: managerOrderStatus,
                    cancelledAt: new Date(),
                    cancellationReason: remarks,
                } as any,
            });
        }

        if (actor.type === 'manager') {
            await tx.adminAuditLog.create({
                data: {
                    adminId: actor.adminId,
                    adminName: actor.adminName,
                    action: 'MANAGER_ORDER_CANCELLED',
                    entity: 'ManagerOrder',
                    targetId: managerOrder?.id || booking.id,
                    oldValue: {
                        bookingStatus: booking.status,
                        paymentStatus: booking.paymentStatus,
                        managerOrderStatus: managerOrder?.status || null,
                    },
                    newValue: {
                        bookingStatus: 'Cancelled',
                        paymentStatus,
                        managerOrderStatus: managerOrderStatus || null,
                        reason: remarks,
                        refundStatus,
                        refundError: refundError || null,
                        partnerCancellation,
                    },
                    ipAddress: actor.ipAddress,
                    isDestructive: true,
                },
            });
        }
    });
}

async function runCancellation(params: {
    booking: CancelBookingRecord;
    managerOrder?: CancelManagerOrderRecord | null;
    actor: CancellationActor;
    remarks: string;
    allowPendingLocalCancel: boolean;
    enableRefunds: boolean;
}) {
    const { booking, managerOrder, actor, remarks, allowPendingLocalCancel, enableRefunds } = params;

    if (isAlreadyCancelled(booking, managerOrder)) {
        throw new Error('This order is already cancelled or refunded');
    }

    if (managerOrder && !MANAGER_CANCELABLE_STATUSES.has(managerOrder.status)) {
        throw new Error('Order cannot be cancelled in its current state');
    }

    let partnerCancellation: 'not_required' | 'cancelled' = 'not_required';
    let partnerResult: Awaited<ReturnType<typeof cancelWithPartner>> | undefined;

    const needsPartnerCancellation = Boolean(
        booking.partnerBookingId &&
        (
            managerOrder?.status === 'CONFIRMED' ||
            (!managerOrder && !allowPendingLocalCancel)
        )
    );

    if (needsPartnerCancellation) {
        partnerResult = await cancelWithPartner(
            booking.partnerBookingId!,
            actor.userId,
            remarks
        );
        partnerCancellation = 'cancelled';
    } else if (!allowPendingLocalCancel && !booking.partnerBookingId) {
        throw new Error('Internal record error: Partner Booking ID is missing');
    }

    const refundAttempt = enableRefunds
        ? await attemptOnlineRefund(booking.id, booking.razorpayPaymentId, remarks)
        : { refundStatus: 'not_applicable' as const };

    const nextPaymentStatus: PaymentStatus = refundAttempt.refundStatus === 'refunded'
        ? 'REFUNDED'
        : 'CANCELLED';
    const nextManagerOrderStatus: CancellationResult['managerOrderStatus'] = managerOrder
        ? (refundAttempt.refundStatus === 'refunded' ? 'REFUNDED' : 'CANCELLED')
        : undefined;

    await applyCancellationUpdates({
        booking,
        managerOrder,
        actor,
        remarks,
        paymentStatus: nextPaymentStatus,
        managerOrderStatus: nextManagerOrderStatus,
        partnerCancellation,
        refundStatus: refundAttempt.refundStatus,
        refundError: 'refundError' in refundAttempt ? refundAttempt.refundError : undefined,
    });

    return {
        message: getCancellationMessage(partnerCancellation, refundAttempt.refundStatus),
        bookingStatus: 'Cancelled' as const,
        paymentStatus: nextPaymentStatus as 'CANCELLED' | 'REFUNDED',
        ...(nextManagerOrderStatus ? { managerOrderStatus: nextManagerOrderStatus } : {}),
        refundStatus: refundAttempt.refundStatus,
        manualRefundRequired: refundAttempt.refundStatus === 'manual_required',
        partnerCancellation,
        ...(partnerResult || {}),
    };
}

export async function cancelManagerOrder(params: {
    managerOrderId: string;
    managerId: string;
    adminId: string;
    adminName: string;
    ipAddress: string;
    remarks: string;
}): Promise<CancellationResult> {
    const order = await loadManagerOrderById(params.managerOrderId, params.managerId);
    if (!order) {
        throw new Error('Order not found or access denied');
    }

    return runCancellation({
        booking: order.booking as any,
        managerOrder: { id: order.id, status: order.status },
        actor: {
            type: 'manager',
            userId: params.managerId,
            adminId: params.adminId,
            adminName: params.adminName,
            ipAddress: params.ipAddress,
        },
        remarks: params.remarks,
        allowPendingLocalCancel: true,
        enableRefunds: true,
    });
}

export async function cancelCustomerBooking(params: {
    bookingId: string;
    userId: string;
    remarks: string;
}): Promise<CancellationResult> {
    const booking = await loadBookingById(params.bookingId, params.userId);
    if (!booking) {
        throw new Error('Booking not found or access denied');
    }

    return runCancellation({
        booking,
        managerOrder: booking.managerOrder ? { id: booking.managerOrder.id, status: booking.managerOrder.status } : null,
        actor: {
            type: 'customer',
            userId: params.userId,
        },
        remarks: params.remarks,
        allowPendingLocalCancel: false,
        enableRefunds: Boolean(booking.managerOrder),
    });
}

export async function cancelGlobalBookingAsManager(params: {
    bookingId: string;
    managerId: string;
    adminId: string;
    adminName: string;
    ipAddress: string;
    remarks: string;
}): Promise<CancellationResult> {
    const booking = await loadGlobalBookingById(params.bookingId);
    if (!booking) {
        throw new Error('Booking not found');
    }

    return runCancellation({
        booking,
        managerOrder: booking.managerOrder ? { id: booking.managerOrder.id, status: booking.managerOrder.status } : null,
        actor: {
            type: 'manager',
            userId: params.managerId,
            adminId: params.adminId,
            adminName: params.adminName,
            ipAddress: params.ipAddress,
        },
        remarks: params.remarks,
        allowPendingLocalCancel: true,
        enableRefunds: true,
    });
}
