import { prisma } from './prisma';
import bcrypt from 'bcrypt';

async function main() {
  console.log('Seeding database...');

  const adminPass = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.upsert({
    where: { phone: '081111111111' },
    update: {},
    create: { name: 'Admin Jeep Tour', phone: '081111111111', passwordHash: adminPass, role: 'admin' },
  });
  console.log('✅ Admin created:', admin.phone);

  const customerPass = await bcrypt.hash('customer123', 10);
  await prisma.user.upsert({
    where: { phone: '082222222222' },
    update: {},
    create: { name: 'Budi Customer', phone: '082222222222', passwordHash: customerPass, role: 'customer' },
  });
  console.log('✅ Customer created: 082222222222');

  const driverPass = await bcrypt.hash('driver123', 10);
  const driverUser = await prisma.user.upsert({
    where: { phone: '083333333333' },
    update: {},
    create: { name: 'Ahmad Driver', phone: '083333333333', passwordHash: driverPass, role: 'driver' },
  });
  await prisma.driver.upsert({
    where: { userId: driverUser.id },
    update: {},
    create: { userId: driverUser.id, vehicleName: 'Jeep Willys CJ7', vehiclePlate: 'AB 1234 CD' },
  });
  console.log('✅ Driver created: 083333333333');

  await prisma.package.upsert({
    where: { id: 'pkg-standar-001' },
    update: {},
    create: {
      id: 'pkg-standar-001',
      name: 'Paket Standar',
      price: 250000,
      durationHours: 2,
      destinations: ['Bukit Teletubbies', 'Savana Gunung Bromo', 'Kawah Bromo', 'Bukit Kingkong'],
      maxPax: 6,
    },
  });
  console.log('✅ Package created: Paket Standar');

  console.log('\n🎉 Seed selesai!');
  console.log('Login credentials:');
  console.log('  Admin:    081111111111 / admin123');
  console.log('  Customer: 082222222222 / customer123');
  console.log('  Driver:   083333333333 / driver123');
}

main().catch(console.error).finally(() => prisma.$disconnect());
