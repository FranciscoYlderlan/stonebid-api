import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${randomUUID()}@e2e.stonebid.dev`;
}

export async function registerUser(
  app: FastifyInstance,
  overrides: Partial<{ name: string; email: string; password: string; role: string }> = {},
) {
  const payload = {
    name: 'Pessoa Teste',
    email: uniqueEmail(),
    password: 'senha-forte-123',
    role: 'BIDDER',
    ...overrides,
  };
  const response = await app.inject({ method: 'POST', url: '/auth/register', payload });
  return { payload, response };
}
