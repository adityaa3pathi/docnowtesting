"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
prisma.user.findUnique({ where: { mobile: '9999999999' } }).then(user => console.log('USER_CREATED:', user ? 'YES' : 'NO', user)).finally(() => prisma.$disconnect());
