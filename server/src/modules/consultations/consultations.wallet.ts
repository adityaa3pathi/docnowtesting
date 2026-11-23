/**
 * The DocNow wallet, as consultations use it. The wallet stores rupees as a float (shared with lab
 * checkout), so every change here goes through SQL that rounds to whole paise, and every change
 * writes a ledger row. A ledger row's (referenceType, referenceId) is unique, which makes each
 * debit, release and refund happen at most once.
 */
import type { Tx } from './consultations.transitions';

/** Ledger reference types. The reference id is the wallet payment row (or, for refunds, the refund record). */
export const WALLET_REF = {
    DEBIT: 'CONSULT', // taken when the slot is held
    RELEASE: 'CONSULT_RELEASE', // the hold ended unpaid: given back
    REDEBIT: 'CONSULT_REDEBIT', // a late card payment brought an expired hold back: taken again
    REFUND: 'CONSULT_REFUND', // a refund of the wallet part
} as const;
type Ref = { type: (typeof WALLET_REF)[keyof typeof WALLET_REF]; id: string };

/** Whole paise the user can spend now. 0 when there is no wallet. */
export async function walletBalancePaise(db: Pick<Tx, '$queryRaw'>, userId: string): Promise<number> {
    const [row] = await db.$queryRaw<{ paise: number }[]>`
        SELECT FLOOR(ROUND(balance::numeric, 2) * 100)::int AS paise FROM "Wallet" WHERE "userId" = ${userId}`;
    return Math.max(0, row?.paise ?? 0);
}

/**
 * Takes `paise` from the wallet if the balance covers it. False when it does not (another tab
 * spent it first); nothing is written then. Must run inside a transaction.
 */
export async function debitWallet(tx: Tx, userId: string, paise: number, ref: Ref, description: string): Promise<boolean> {
    if (!Number.isInteger(paise) || paise <= 0) throw new Error('Wallet debit must be a positive whole number of paise');
    const [wallet] = await tx.$queryRaw<{ id: string; balance: number }[]>`
        UPDATE "Wallet" SET balance = ROUND(balance::numeric - ${paise}::numeric / 100, 2)::float8, "updatedAt" = now()
        WHERE "userId" = ${userId} AND ROUND(balance::numeric, 2) >= ${paise}::numeric / 100
        RETURNING id, balance`;
    if (!wallet) return false;
    await tx.walletLedger.create({
        data: { walletId: wallet.id, type: 'DEBIT', amount: -paise / 100, balanceAfter: wallet.balance, description, referenceType: ref.type, referenceId: ref.id },
    });
    return true;
}

/**
 * Gives `paise` back. Idempotent: a second call with the same reference changes nothing and
 * returns false. Creates the wallet if the user has none. Must run inside a transaction.
 */
export async function creditWallet(tx: Tx, userId: string, paise: number, ref: Ref, description: string): Promise<boolean> {
    if (!Number.isInteger(paise) || paise <= 0) throw new Error('Wallet credit must be a positive whole number of paise');
    await tx.$executeRaw`
        INSERT INTO "Wallet" ("id", "userId", "balance", "createdAt", "updatedAt")
        VALUES (gen_random_uuid()::text, ${userId}, 0, now(), now())
        ON CONFLICT ("userId") DO NOTHING`;
    const [wallet] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE`;
    // ON CONFLICT, not a caught error: a failed insert would abort the caller's transaction.
    const [entry] = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO "WalletLedger" ("id", "walletId", "type", "amount", "balanceAfter", "description", "referenceType", "referenceId", "createdAt")
        VALUES (gen_random_uuid()::text, ${wallet.id}, 'CREDIT', ${paise / 100}, 0, ${description}, ${ref.type}, ${ref.id}, now())
        ON CONFLICT ("referenceType", "referenceId") DO NOTHING
        RETURNING id`;
    if (!entry) return false;
    const [after] = await tx.$queryRaw<{ balance: number }[]>`
        UPDATE "Wallet" SET balance = ROUND(balance::numeric + ${paise}::numeric / 100, 2)::float8, "updatedAt" = now()
        WHERE id = ${wallet.id} RETURNING balance`;
    await tx.walletLedger.update({ where: { id: entry.id }, data: { balanceAfter: after.balance } });
    return true;
}

const short = (id: string) => id.slice(0, 8);
export const walletText = {
    paid: (consultationId: string) => `Paid for consultation #${short(consultationId)}`,
    released: (consultationId: string) => `Consultation #${short(consultationId)} not paid in time: returned`,
    repaid: (consultationId: string) => `Paid for consultation #${short(consultationId)} (payment arrived late)`,
    refund: (consultationId: string) => `Refund for consultation #${short(consultationId)}`,
};

/**
 * The wallet part of an unpaid hold goes back to the wallet. Called whenever a hold ends without
 * payment (expiry, cancel before paying). A no-op when there is no wallet part or it already went back.
 */
export async function releaseWalletHold(tx: Tx, consultationId: string): Promise<void> {
    const part = await tx.consultationPayment.findFirst({ where: { consultationId, source: 'WALLET', status: 'CREATED' } });
    if (!part) return;
    const res = await tx.consultationPayment.updateMany({ where: { id: part.id, status: 'CREATED' }, data: { status: 'RELEASED' } });
    if (res.count !== 1) return;
    const c = await tx.consultation.findUniqueOrThrow({ where: { id: consultationId }, select: { userId: true } });
    await creditWallet(tx, c.userId, part.amountPaise, { type: WALLET_REF.RELEASE, id: part.id }, walletText.released(consultationId));
}

/** On confirmation the wallet part held for the booking counts as paid. */
export async function captureWalletHold(tx: Tx, consultationId: string, now: Date): Promise<void> {
    await tx.consultationPayment.updateMany({
        where: { consultationId, source: 'WALLET', status: 'CREATED' },
        data: { status: 'CAPTURED', capturedAt: now },
    });
}

/**
 * A late card payment is bringing an expired hold back: the wallet part released at expiry must be
 * taken again. False when the wallet no longer covers it; the caller then refunds the card instead.
 */
export async function retakeWalletHold(tx: Tx, consultationId: string, now: Date): Promise<boolean> {
    const part = await tx.consultationPayment.findFirst({ where: { consultationId, source: 'WALLET' } });
    if (!part || part.status === 'CAPTURED') return true;
    if (part.status === 'CREATED') {
        await captureWalletHold(tx, consultationId, now);
        return true;
    }
    const c = await tx.consultation.findUniqueOrThrow({ where: { id: consultationId }, select: { userId: true } });
    if (!(await debitWallet(tx, c.userId, part.amountPaise, { type: WALLET_REF.REDEBIT, id: part.id }, walletText.repaid(consultationId)))) return false;
    const res = await tx.consultationPayment.updateMany({ where: { id: part.id, status: 'RELEASED' }, data: { status: 'CAPTURED', capturedAt: now } });
    return res.count === 1;
}
