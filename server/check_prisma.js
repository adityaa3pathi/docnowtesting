"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('Checking Prisma Client User Model...');
    try {
        const user = await prisma.user.findFirst();
        console.log('User found:', user);
        console.log('User keys:', user ? Object.keys(user) : 'No user');
    }
    catch (error) {
        console.error('Error querying User:', error);
    }
    finally {
        await prisma.$disconnect();
    }
}
main();
