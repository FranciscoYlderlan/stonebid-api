import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { placeBidBodySchema } from '../../http/schemas/bid-schemas.ts';
import { idempotencyKeySchema } from '../../http/schemas/wallet-schemas.ts';
import { callRoute, toToolResult } from '../call-route.ts';
import type { McpSessionState } from '../session.ts';

const lotIdInput = { id: z.string().min(1).describe('id do lote (UUID)') };

/** Tools de lances (RF-33, RF-70). `bids_place` age como o licitante escolhido na tool entrar. */
export function registerBidsTools(
  server: McpServer,
  app: FastifyInstance,
  state: McpSessionState,
): void {
  server.registerTool(
    'bids_place',
    {
      title: 'Dar lance',
      description:
        'POST /lots/:id/bids com { amountCents } e o cabeçalho Idempotency-Key. Só licitante ' +
        '(entre como licitante-1 ou licitante-2). Devolve { bid, lot, wallet }; lot.minNextBidCents ' +
        'é o menor lance aceito. Mesma chave e mesmo valor → 200 com o mesmo lance; chave reusada em ' +
        'outro lance → 409 IDEMPOTENCY_KEY_REUSED. Recusas: 422 BID_BELOW_MINIMUM ' +
        '(details.minAmountCents), 422 INSUFFICIENT_FUNDS (details.availableCents), 409 ' +
        'ALREADY_WINNING, LOT_NOT_STARTED, LOT_ENDED ou LOT_CANCELED, 403 FORBIDDEN (leiloeiro).',
      inputSchema: {
        ...lotIdInput,
        ...placeBidBodySchema.shape,
        idempotencyKey: idempotencyKeySchema,
      },
    },
    async ({ id, amountCents, idempotencyKey }) =>
      toToolResult(
        await callRoute(app, {
          method: 'POST',
          url: `/lots/${encodeURIComponent(id)}/bids`,
          body: { amountCents },
          headers: { 'idempotency-key': idempotencyKey },
          token: state.token,
        }),
      ),
  );

  server.registerTool(
    'bids_list',
    {
      title: 'Histórico de lances',
      description:
        'GET /lots/:id/bids: lances do lote, do mais novo para o mais antigo, com pseudônimo ' +
        '("Licitante 7F3A9C"), sem nome, e-mail nem id do licitante. Público.',
      inputSchema: lotIdInput,
    },
    async ({ id }) =>
      toToolResult(
        await callRoute(app, { method: 'GET', url: `/lots/${encodeURIComponent(id)}/bids` }),
      ),
  );

  server.registerTool(
    'bids_mine',
    {
      title: 'Meus lances',
      description:
        'GET /me/bids: lotes em que o licitante da sessão deu lance, mais recentes primeiro, com ' +
        'myMaxBidCents, position (LEADING, OUTBID, WON, LOST ou CANCELED) e receiptPublicId (só ' +
        'em WON). Só licitante.',
    },
    async () =>
      toToolResult(await callRoute(app, { method: 'GET', url: '/me/bids', token: state.token })),
  );
}
