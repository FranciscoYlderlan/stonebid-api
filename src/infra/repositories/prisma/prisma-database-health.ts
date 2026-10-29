import { prisma } from './prisma-client.ts';

/** Confirma que o banco responde. Lança erro se a consulta falhar. */
export async function checkDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
