const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const tests = await prisma.catalogItem.count({ where: { type: 'TEST' } });
  const packages = await prisma.catalogItem.count({ where: { type: { in: ['PACKAGE', 'PROFILE'] } } });
  const users = await prisma.user.count();
  const bookings = await prisma.booking.count();
  console.log(`Tests: ${tests}`);
  console.log(`Packages: ${packages}`);
  console.log(`Users: ${users}`);
  console.log(`Bookings: ${bookings}`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
