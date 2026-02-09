"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
prisma.oTP.findFirst({ orderBy: { createdAt: 'desc' } }).then(otp => console.log('LATEST_OTP:', otp?.code)).finally(() => prisma.$disconnect());
