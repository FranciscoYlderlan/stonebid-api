import { execSync } from 'node:child_process';
import { testEnv } from './test-env.ts';

/** Domínio dos e-mails criados pelos testes E2E (test/e2e/helpers.ts). */
export const E2E_EMAIL_DOMAIN = '@e2e.stonebid.dev';

/**
 * Antes da suíte: aplica as migrations no banco de teste (não destrutivo), roda o seed
 * e remove só os usuários que testes anteriores criaram.
 */
export default async function setup(): Promise<void> {
  Object.assign(process.env, testEnv);
  const options = { stdio: 'inherit', env: process.env } as const;
  execSync('npx prisma migrate deploy', options);
  execSync('npx prisma db seed', options);

  const { prisma } = await import('../src/infra/repositories/prisma/prisma-client.ts');
  await prisma.user.deleteMany({ where: { email: { endsWith: E2E_EMAIL_DOMAIN } } });
  await prisma.$disconnect();
}
