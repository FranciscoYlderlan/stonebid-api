import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { searchItemsInputSchema } from '../../http/schemas/lot-schemas.ts';
import { callRoute, toToolResult } from '../call-route.ts';
import type { McpSessionState } from '../session.ts';

export function registerItemsTools(
  server: McpServer,
  app: FastifyInstance,
  state: McpSessionState,
): void {
  server.registerTool(
    'items_search',
    {
      title: 'Buscar itens na API externa',
      description:
        'GET /items/search?q=&page=: busca obras com imagem no Art Institute of Chicago. ' +
        'Só leiloeiro (entre como leiloeiro antes). Use o externalId do resultado em lots_create. ' +
        'O imageUrl de cada item é relativo à API (GET /items/images/{imageId}/thumbnail, público).',
      inputSchema: searchItemsInputSchema.shape,
    },
    async ({ q, page }) => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (page) params.set('page', String(page));
      const query = params.toString();
      return toToolResult(
        await callRoute(app, {
          method: 'GET',
          url: `/items/search${query ? `?${query}` : ''}`,
          token: state.token,
        }),
      );
    },
  );
}
