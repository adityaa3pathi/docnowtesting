"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const nanoid_1 = require("nanoid");
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('🌱 Starting database seed...');
    // ========================================
    // 1. Seed SUPER_ADMIN user
    // ========================================
    const adminMobile = '9999999999';
    const adminEmail = 'admin@docnow.in';
    const adminPassword = await bcryptjs_1.default.hash('Admin@123', 10);
    const existingAdmin = await prisma.user.findFirst({
        where: { role: 'SUPER_ADMIN' }
    });
    if (!existingAdmin) {
        const admin = await prisma.user.upsert({
            where: { mobile: adminMobile },
            update: {
                role: 'SUPER_ADMIN',
                status: 'ACTIVE',
                isVerified: true,
                name: 'Super Admin',
                email: adminEmail,
                password: adminPassword,
            },
            create: {
                mobile: adminMobile,
                email: adminEmail,
                name: 'Super Admin',
                password: adminPassword,
                role: 'SUPER_ADMIN',
                status: 'ACTIVE',
                isVerified: true,
                referralCode: `ADMIN${(0, nanoid_1.nanoid)(4).toUpperCase()}`,
            },
        });
        // Create wallet for admin
        await prisma.wallet.upsert({
            where: { userId: admin.id },
            update: {},
            create: { userId: admin.id },
        });
        console.log('✅ SUPER_ADMIN user created:');
        console.log(`   Mobile: ${adminMobile}`);
        console.log(`   Email: ${adminEmail}`);
        console.log(`   Password: Admin@123`);
    }
    else {
        console.log('ℹ️  SUPER_ADMIN already exists, skipping...');
    }
    // ========================================
    // 2. Seed System Configurations
    // ========================================
    const configs = [
        { key: 'REFERRAL_REWARD_X', value: '50', description: 'Referee signup bonus' },
        { key: 'REFERRAL_REWARD_Y', value: '100', description: 'Referrer first order bonus' },
    ];
    for (const config of configs) {
        await prisma.systemConfig.upsert({
            where: { key: config.key },
            update: {},
            create: {
                key: config.key,
                value: config.value,
            },
        });
        console.log(`✅ Config "${config.key}" = ${config.value}`);
    }
    // ========================================
    // 3. Generate referral codes for existing users
    // ========================================
    const usersWithoutCode = await prisma.user.findMany({
        where: { referralCode: null },
    });
    for (const user of usersWithoutCode) {
        const prefix = (user.name?.substring(0, 3) || 'DOC').toUpperCase();
        const code = `${prefix}${(0, nanoid_1.nanoid)(5).toUpperCase()}`;
        await prisma.user.update({
            where: { id: user.id },
            data: { referralCode: code },
        });
    }
    if (usersWithoutCode.length > 0) {
        console.log(`✅ Generated referral codes for ${usersWithoutCode.length} existing users`);
    }
    // ========================================
    // 4. Create wallets for existing users
    // ========================================
    const usersWithoutWallet = await prisma.user.findMany({
        where: { wallet: null },
    });
    for (const user of usersWithoutWallet) {
        await prisma.wallet.create({
            data: { userId: user.id },
        });
    }
    if (usersWithoutWallet.length > 0) {
        console.log(`✅ Created wallets for ${usersWithoutWallet.length} existing users`);
    }
    console.log('🎉 Seed completed successfully!');
}
main()
    .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
