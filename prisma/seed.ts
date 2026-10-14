import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const viewerPassword = process.env.SEED_VIEWER_PASSWORD;

  if (!adminPassword || !viewerPassword) {
    console.error(
      'Error: SEED_ADMIN_PASSWORD and SEED_VIEWER_PASSWORD environment variables are required.'
    );
    process.exit(1);
  }

  const saltRounds = 12;
  const adminPasswordHash = await bcrypt.hash(adminPassword, saltRounds);
  const viewerPasswordHash = await bcrypt.hash(viewerPassword, saltRounds);

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@cicd.internal' },
    update: {
      password: adminPasswordHash,
      role: Role.ADMIN,
    },
    create: {
      email: 'admin@cicd.internal',
      password: adminPasswordHash,
      role: Role.ADMIN,
    },
  });

  const viewerUser = await prisma.user.upsert({
    where: { email: 'viewer@cicd.internal' },
    update: {
      password: viewerPasswordHash,
      role: Role.VIEWER,
    },
    create: {
      email: 'viewer@cicd.internal',
      password: viewerPasswordHash,
      role: Role.VIEWER,
    },
  });

  console.log(`Successfully seeded users: ${adminUser.email} (ADMIN), ${viewerUser.email} (VIEWER)`);
}

main()
  .catch((e) => {
    console.error('Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
