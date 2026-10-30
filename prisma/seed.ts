/**
 * Seed reexecutável (RNF-02): cria ou atualiza os usuários de teste com upsert e dá aos
 * licitantes um depósito inicial com chave de idempotência fixa (não duplica ao rodar de novo).
 * Lotes entram no I1.
 */
import { hashPassword } from '../src/application/password-hashing.ts';
import type { Role } from '../src/domain/entities/user.ts';
import { env } from '../src/env/index.ts';
import { prisma } from '../src/infra/repositories/prisma/prisma-client.ts';

const seedUsers: { name: string; email: string; role: Role }[] = [
  { name: 'Leiloeiro', email: 'leiloeiro@stonebid.dev', role: 'AUCTIONEER' },
  { name: 'Licitante 1', email: 'licitante-1@stonebid.dev', role: 'BIDDER' },
  { name: 'Licitante 2', email: 'licitante-2@stonebid.dev', role: 'BIDDER' },
];

/** Depósito inicial dos licitantes: R$ 5.000,00. */
const SEED_DEPOSIT_CENTS = 500_000;

async function main(): Promise<void> {
  if (!env.SEED_PASSWORD) throw new Error('Defina SEED_PASSWORD para rodar o seed.');
  const passwordHash = await hashPassword(env.SEED_PASSWORD);

  for (const user of seedUsers) {
    await prisma.user.upsert({
      where: { email: user.email },
      create: { ...user, passwordHash },
      update: { name: user.name, role: user.role, passwordHash },
    });
    console.log(`seed: ${user.email} (${user.role})`);
  }

  for (const user of seedUsers.filter((u) => u.role === 'BIDDER')) {
    const { id: userId } = await prisma.user.findUniqueOrThrow({ where: { email: user.email } });
    // ON CONFLICT DO NOTHING no índice (user_id, idempotency_key): o extrato nunca é alterado.
    const { count } = await prisma.walletMovement.createMany({
      data: {
        userId,
        type: 'DEPOSIT',
        amountCents: SEED_DEPOSIT_CENTS,
        idempotencyKey: `seed-deposit-${user.email}`,
      },
      skipDuplicates: true,
    });
    console.log(`seed: depósito inicial de ${user.email} (${count ? 'criado' : 'já existia'})`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
