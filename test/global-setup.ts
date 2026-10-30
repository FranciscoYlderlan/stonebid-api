import { execSync } from 'node:child_process';
import { testEnv } from './test-env.ts';

/** Domínio dos e-mails criados pelos testes E2E (test/e2e/helpers.ts). */
export const E2E_EMAIL_DOMAIN = '@e2e.stonebid.dev';

/**
 * Antes da suíte: aplica as migrations no banco de teste (não destrutivo), roda o seed
 * e remove só os lotes, os usuários, os comprovantes, os lances e os movimentos de carteira que testes
 * anteriores criaram (os do seed ficam).
 */
export default async function setup(): Promise<void> {
  Object.assign(process.env, testEnv);
  const options = { stdio: 'inherit', env: process.env } as const;
  execSync('npx prisma migrate deploy', options);
  execSync('npx prisma db seed', options);

  const { prisma } = await import('../src/infra/repositories/prisma/prisma-client.ts');
  const testLots = { NOT: { externalId: { startsWith: 'seed-' } } };
  const e2eUsers = { email: { endsWith: E2E_EMAIL_DOMAIN } };
  // Comprovantes, lances e extrato referenciam lote e usuário (chaves estrangeiras sem cascata):
  // saem antes.
  await prisma.receipt.deleteMany({ where: { lot: testLots } });
  await prisma.bid.deleteMany({ where: { OR: [{ lot: testLots }, { bidder: e2eUsers }] } });
  await prisma.walletMovement.deleteMany({
    where: { OR: [{ lot: testLots }, { user: e2eUsers }] },
  });
  await prisma.lot.deleteMany({ where: testLots });
  await prisma.user.deleteMany({ where: e2eUsers });
  await prisma.$disconnect();
}
