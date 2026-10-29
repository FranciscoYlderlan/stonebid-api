import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { toToolResult } from '../call-route.ts';
import { seedUserKeys, signInAsSeedUser, type McpSessionState } from '../session.ts';

export function registerSessionTools(
  server: McpServer,
  app: FastifyInstance,
  state: McpSessionState,
): void {
  server.registerTool(
    'entrar',
    {
      title: 'Entrar como usuário de teste',
      description:
        'Faz login (POST /auth/login) com um usuário de teste do seed e guarda a sessão. ' +
        'As tools protegidas passam a agir como esse usuário. Chame de novo para trocar de usuário.',
      inputSchema: { user: z.enum(seedUserKeys) },
    },
    async ({ user }) => toToolResult(await signInAsSeedUser(app, state, user)),
  );
}
