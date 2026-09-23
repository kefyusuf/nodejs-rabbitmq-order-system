import { PrismaClient } from '../../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env';

const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
});

export const prisma = new PrismaClient({ adapter });

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
