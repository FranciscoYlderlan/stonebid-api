import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { loginBodySchema, registerBodySchema } from '../../http/schemas/auth-schemas.ts';
import { callRoute, toToolResult } from '../call-route.ts';
import type { McpSessionState } from '../session.ts';

export function registerAuthTools(
  server: McpServer,
  app: FastifyInstance,
  state: McpSessionState,
): void {
  server.registerTool(
    'auth_register',
    {
      title: 'Cadastrar conta',
      description: 'POST /auth/register: cria uma conta com um papel (AUCTIONEER ou BIDDER).',
      inputSchema: registerBodySchema.shape,
    },
    async (body) =>
      toToolResult(await callRoute(app, { method: 'POST', url: '/auth/register', body })),
  );

  server.registerTool(
    'auth_login',
    {
      title: 'Login',
      description:
        'POST /auth/login com e-mail e senha. Só devolve a resposta da rota; ' +
        'para agir como um usuário de teste, use a tool entrar.',
      inputSchema: loginBodySchema.shape,
    },
    async (body) =>
      toToolResult(await callRoute(app, { method: 'POST', url: '/auth/login', body })),
  );

  server.registerTool(
    'auth_me',
    {
      title: 'Quem sou eu',
      description:
        'GET /auth/me com a sessão da tool entrar. Sem entrar antes, a rota responde 401.',
    },
    async () =>
      toToolResult(await callRoute(app, { method: 'GET', url: '/auth/me', token: state.token })),
  );
}
