import type { FastifyInstance } from 'fastify';
import { env } from '../../env/index.ts';
import type { PublicUser } from '../../domain/entities/user.ts';
import { callRoute, type RouteResult } from './call-route.ts';

/** Usuários de teste criados pelo seed (prisma/seed.ts). */
export const seedUsers = {
  leiloeiro: 'leiloeiro@stonebid.dev',
  'licitante-1': 'licitante-1@stonebid.dev',
  'licitante-2': 'licitante-2@stonebid.dev',
} as const;

export type SeedUserKey = keyof typeof seedUsers;
export const seedUserKeys = Object.keys(seedUsers) as [SeedUserKey, ...SeedUserKey[]];

/** Estado de uma sessão MCP: com qual usuário de teste o Claude está agindo. */
export interface McpSessionState {
  token?: string;
  user?: PublicUser;
}

/** Faz login pela rota real (POST /auth/login) e guarda o token na sessão MCP. */
export async function signInAsSeedUser(
  app: FastifyInstance,
  state: McpSessionState,
  key: SeedUserKey,
): Promise<RouteResult> {
  const result = await callRoute(app, {
    method: 'POST',
    url: '/auth/login',
    body: { email: seedUsers[key], password: env.SEED_PASSWORD },
  });

  if (result.status === 200) {
    const body = result.body as { user: PublicUser; token: string };
    state.token = body.token;
    state.user = body.user;
    // O token fica só na sessão; a resposta da tool mostra quem entrou, não o token.
    return { status: result.status, body: { user: body.user } };
  }

  state.token = undefined;
  state.user = undefined;
  return result;
}
