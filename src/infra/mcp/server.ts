import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import type { McpSessionState } from './session.ts';
import { registerAuthTools } from './tools/auth-tools.ts';
import { registerHealthTools } from './tools/health-tools.ts';
import { registerSessionTools } from './tools/session-tools.ts';
import { registerWalletTools } from './tools/wallet-tools.ts';

/** Cria um servidor MCP por sessão, com as tools ligadas ao estado daquela sessão. */
export function createMcpServer(app: FastifyInstance, state: McpSessionState): McpServer {
  const server = new McpServer({ name: 'stonebid-api', version: '0.1.0' });

  registerSessionTools(server, app, state);
  registerHealthTools(server, app);
  registerAuthTools(server, app, state);
  registerWalletTools(server, app, state);

  return server;
}
