/**
 * One-time migration: Sync all Wallet.balance fields from WalletLedger.
 * 
 * The adjustWallet controller previously created ledger entries but
 * didn't update Wallet.balance. This script recalculates the correct
 * balance from the ledger and patches each wallet.
 * 
 * Usage: npx ts-node prisma/sync-wallet-balances.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🔄 Syncing wallet balances from ledger...\n');

    const wallets = await prisma.wallet.findMany({
        include: {
            user: { select: { name: true, mobile: true } },
            ledger: { select: { amount: true } }
        }
    });

    let fixed = 0;

    for (const wallet of wallets) {
        const correctBalance = wallet.ledger.reduce((sum, entry) => sum + entry.amount, 0);

        if (Math.abs(wallet.balance - correctBalance) > 0.01) {
            await prisma.wallet.update({
                where: { id: wallet.id },
                data: { balance: correctBalance }
            });
            console.log(`  ✅ ${wallet.user.name} (${wallet.user.mobile}): ₹${wallet.balance} → ₹${correctBalance}`);
            fixed++;
        } else {
            console.log(`  ⏭️  ${wallet.user.name} (${wallet.user.mobile}): ₹${correctBalance} (already correct)`);
        }
    }

    console.log(`\n✅ Done. Fixed ${fixed}/${wallets.length} wallets.`);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
