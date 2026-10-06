import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole, UserStatus } from '../generated/prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error('SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD are required');
  }
  if (password.length < 12) {
    throw new Error('Super Admin password must be at least 12 characters');
  }

  const existing = await prisma.user.findUnique({
    where: { email_role: { email, role: UserRole.ADMIN } },
    select: { id: true },
  });
  if (existing) {
    console.log(`Super Admin ${email} already exists, skipping.`);
    return;
  }

  const admin = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, 12),
      firstName: 'Super',
      lastName: 'Admin',
      role: UserRole.ADMIN,
      isSubAdmin: false,
      status: UserStatus.ACTIVE,
      isEmailVerified: true,
      emailVerifiedAt: new Date(),
      twoFactorEnabled: false,
      twoFactorSecret: null,
    },
    select: { email: true },
  });

  console.log('Super Admin created:', admin.email);
}

main()
  .catch((error) => {
    console.error('Failed to create Super Admin:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
