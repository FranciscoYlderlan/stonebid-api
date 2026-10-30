import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { depositBodySchema, idempotencyKeySchema } from '../../http/schemas/wallet-schemas.ts';
import { callRoute, toToolResult } from '../call-route.ts';
import type { McpSessionState } from '../session.ts';

/** Tools da carteira (RF-40 a RF-42). Agem como o usuário escolhido na tool entrar. */
export function registerWalletTools(
  server: McpServer,
  app: FastifyInstance,
  state: McpSessionState,
): void {
  server.registerTool(
    'wallet_get',
    {
      title: 'Saldo da carteira',
      description:
        'GET /wallet: total, comprometido, disponível e teto do depósito (depositLimitCents), em centavos. ' +
        'Só licitante (entre como licitante-1 ou licitante-2).',
    },
    async () =>
      toToolResult(await callRoute(app, { method: 'GET', url: '/wallet', token: state.token })),
  );

  server.registerTool(
    'wallet_deposit',
    {
      title: 'Depositar na carteira',
      description:
        'POST /wallet/deposits com { amountCents } e o cabeçalho Idempotency-Key. ' +
        'Devolve { movement, wallet }, com wallet no formato do wallet_get (inclui depositLimitCents). ' +
        'Repetir a mesma chave com o mesmo valor devolve o mesmo depósito (200), sem depositar de novo; ' +
        'com outro valor, 409. Use uma chave nova (8 a 128 caracteres) para cada depósito.',
      inputSchema: { ...depositBodySchema.shape, idempotencyKey: idempotencyKeySchema },
    },
    async ({ amountCents, idempotencyKey }) =>
      toToolResult(
        await callRoute(app, {
          method: 'POST',
          url: '/wallet/deposits',
          body: { amountCents },
          headers: { 'idempotency-key': idempotencyKey },
          token: state.token,
        }),
      ),
  );

  server.registerTool(
    'wallet_movements',
    {
      title: 'Extrato da carteira',
      description: 'GET /wallet/movements: movimentos do licitante, mais recentes primeiro.',
    },
    async () =>
      toToolResult(
        await callRoute(app, { method: 'GET', url: '/wallet/movements', token: state.token }),
      ),
  );
}
