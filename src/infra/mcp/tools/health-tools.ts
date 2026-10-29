import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { callRoute, toToolResult } from '../call-route.ts';

export function registerHealthTools(server: McpServer, app: FastifyInstance): void {
  server.registerTool(
    'health',
    {
      title: 'Saúde da API',
      description: 'GET /health: confirma que a API e o banco respondem.',
    },
    async () => toToolResult(await callRoute(app, { method: 'GET', url: '/health' })),
  );
}
