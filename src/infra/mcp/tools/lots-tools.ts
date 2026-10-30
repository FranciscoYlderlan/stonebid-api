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
        'datas ISO 8601 em UTC. Início não pode estar no passado; fim ≥ início + 5 min. Só leiloeiro.',
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
      description: 'GET /lots/:id: lote público com o estado pelo relógio do servidor.',
      inputSchema: lotIdInput,
    },
    async ({ id }) =>
      toToolResult(await callRoute(app, { method: 'GET', url: `/lots/${encodeURIComponent(id)}` })),
  );

  server.registerTool(
    'auctioneer_lots',
    {
      title: 'Meus lotes (leiloeiro)',
      description: 'GET /auctioneer/lots: lotes do leiloeiro da sessão, inclusive cancelados.',
    },
    async () =>
      toToolResult(
        await callRoute(app, { method: 'GET', url: '/auctioneer/lots', token: state.token }),
      ),
  );

  server.registerTool(
    'lots_cancel',
    {
      title: 'Cancelar lote',
      description:
        'POST /lots/:id/cancel: cancela um lote agendado ou ao vivo, sem lances. Só o leiloeiro dono.',
      inputSchema: lotIdInput,
    },
    async ({ id }) =>
      toToolResult(
        await callRoute(app, {
          method: 'POST',
          url: `/lots/${encodeURIComponent(id)}/cancel`,
          token: state.token,
        }),
      ),
  );
}
