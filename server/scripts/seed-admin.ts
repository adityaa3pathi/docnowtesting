import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
    console.log('--- DOCNOW Super Admin Seeder ---');
    
    const mobile = '9999999999';
    const plainPassword = 'Admin@123';
    
    // Check if user exists
    const existing = await prisma.user.findUnique({
        where: { mobile }
    });
    
    const hashedPassword = await bcrypt.hash(plainPassword, 10);
    
    if (existing) {
        console.log(`User with mobile ${mobile} already exists. Upgrading to SUPER_ADMIN.`);
        await prisma.user.update({
            where: { mobile },
            data: { 
                role: 'SUPER_ADMIN',
                password: hashedPassword
            }
        });
        console.log('Successfully updated existing user.');
    } else {
        console.log(`Creating fresh SUPER_ADMIN user for mobile ${mobile}...`);
        await prisma.user.create({
            data: {
                name: 'Super Admin',
                mobile,
                password: hashedPassword,
                role: 'SUPER_ADMIN',
                isVerified: true
            }
        });
        console.log('Successfully created fresh super admin account.');
    }
    
    console.log('\nSeed Complete!');
    console.log(`Login Mobile: ${mobile}`);
    console.log(`Login Password: ${plainPassword}`);
}

main()
    .catch((e) => {
        console.error('Error during seeding:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
