import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createLotBodySchema } from '../../http/schemas/lot-schemas.ts';
import { callRoute, toToolResult } from '../call-route.ts';
import type { McpSessionState } from '../session.ts';

const lotIdInput = { id: z.string().min(1).describe('id do lote (UUID)') };

export function registerLotsTools(
  server: McpServer,
  app: FastifyInstance,
  state: McpSessionState,
): void {
  server.registerTool(
    'lots_create',
    {
      title: 'Criar lote',
      description:
        'POST /lots: cria um lote a partir de um item da busca (externalId). Valores em centavos; ' +
        'datas ISO 8601 em UTC. Início não pode estar no passado; fim ≥ início + 5 min. Só leiloeiro. ' +
        'RN-19: obra com lote agendado, ao vivo ou arrematado → 409 ITEM_ALREADY_AUCTIONED, com ' +
        'error.details { status, lotId } do lote que prende a obra.',
      inputSchema: createLotBodySchema.shape,
    },
    async (body) =>
      toToolResult(
        await callRoute(app, { method: 'POST', url: '/lots', body, token: state.token }),
      ),
  );

  server.registerTool(
    'lots_list',
    {
      title: 'Vitrine de lotes',
      description:
        'GET /lots: vitrine pública em três seções (live, scheduled, ended), sem cancelados.',
    },
    async () => toToolResult(await callRoute(app, { method: 'GET', url: '/lots' })),
  );

  server.registerTool(
    'lots_get',
    {
      title: 'Detalhe do lote',
      description:
        'GET /lots/:id: lote público com o estado pelo relógio do servidor (lote vencido é ' +
        'liquidado na leitura: result SOLD ou NO_WINNER, receiptPublicId). Com licitante na ' +
        'sessão, lot.viewer.pseudonym traz o pseudônimo dele no lote.',
      inputSchema: lotIdInput,
    },
    async ({ id }) =>
      toToolResult(
        await callRoute(app, {
          method: 'GET',
          url: `/lots/${encodeURIComponent(id)}`,
          token: state.token,
        }),
      ),
  );

  server.registerTool(
    'lots_audit',
    {
      title: 'Auditoria do lote',
      description:
        'GET /lots/:id/audit: auditoria pública, recalculada a cada chamada (lote vencido é ' +
        'liquidado na leitura). Devolve o lote, os lances em ordem de seq (pseudônimo, valor, ' +
        'hora, prevHash, hash), verdict INTACT ou TAMPERED e firstInconsistency { seq, reason } ' +
        '(GAP, CONTENT_CHANGED, BAD_SEAL, BROKEN_LINK, HEAD_MISMATCH, RECEIPT_MISMATCH, ' +
        'SETTLEMENT_MISMATCH). Sem dado pessoal. Lote inexistente → 404 LOT_NOT_FOUND.',
      inputSchema: { lotId: z.string().min(1).describe('id do lote (UUID)') },
    },
    async ({ lotId }) =>
      toToolResult(
        await callRoute(app, { method: 'GET', url: `/lots/${encodeURIComponent(lotId)}/audit` }),
      ),
  );

  server.registerTool(
    'auctioneer_lots',
    {
      title: 'Meus lotes (leiloeiro)',
      description:
        'GET /auctioneer/lots: lotes do leiloeiro da sessão, inclusive cancelados, e ' +
        'totalReceivedCents (soma do que recebeu nas liquidações).',
    },
    async () =>
      toToolResult(
        await callRoute(app, { method: 'GET', url: '/auctioneer/lots', token: state.token }),
      ),
  );

  server.registerTool(
    'receipts_get',
    {
      title: 'Comprovante',
      description:
        'GET /receipts/:publicId: comprovante público do lote arrematado (título, valor final, ' +
        'data, pseudônimo do vencedor, hash final e auditPath), sem dado pessoal. Inexistente ou ' +
        'adulterado → 404 RECEIPT_NOT_FOUND.',
      inputSchema: {
        publicId: z
          .string()
          .min(1)
          .describe('identificador público do comprovante (22 caracteres)'),
      },
    },
    async ({ publicId }) =>
      toToolResult(
        await callRoute(app, {
          method: 'GET',
          url: `/receipts/${encodeURIComponent(publicId)}`,
        }),
      ),
  );

  server.registerTool(
    'lots_cancel',
    {
      title: 'Cancelar lote',
      description:
        'POST /lots/:id/cancel com { reason }: cancela um lote agendado ou ao vivo, sem lances. Só ' +
        'o leiloeiro dono. Motivo de 3 a 280 caracteres (senão 422 VALIDATION_ERROR); encerrado ' +
        'ou liquidado → 409 LOT_ENDED; com lances ou já cancelado → 409 LOT_NOT_CANCELABLE.',
      inputSchema: {
        ...lotIdInput,
        reason: z.string().describe('motivo do cancelamento (3 a 280 caracteres)'),
      },
    },
    async ({ id, reason }) =>
      toToolResult(
        await callRoute(app, {
          method: 'POST',
          url: `/lots/${encodeURIComponent(id)}/cancel`,
          body: { reason },
          token: state.token,
        }),
      ),
  );
}
