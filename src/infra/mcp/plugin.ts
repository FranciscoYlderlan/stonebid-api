import { randomUUID, timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../../env/index.ts';
import { sendError } from '../http/errors/error-handler.ts';
import { createMcpServer } from './server.ts';
import type { McpSessionState } from './session.ts';

interface McpSession {
  transport: StreamableHTTPServerTransport;
  state: McpSessionState;
}

function extractApiKey(request: FastifyRequest): string | undefined {
  const headerKey = request.headers['x-api-key'];
  if (typeof headerKey === 'string' && headerKey) return headerKey;

  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) return authorization.slice('Bearer '.length).trim();

  return undefined;
}

function isValidApiKey(received: string | undefined, expected: string): boolean {
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Camada MCP em /mcp (Streamable HTTP, sessão por `mcp-session-id`).
 * Registrada só com MCP_ENABLED=true e exige a api_key em toda requisição.
 * O cabeçalho Authorization daqui carrega a api_key; o token do usuário de teste
 * vai só nos `app.inject()` internos (call-route.ts).
 */
export async function mcpPlugin(app: FastifyInstance): Promise<void> {
  const apiKey = env.MCP_API_KEY;
  if (!apiKey) throw new Error('MCP_API_KEY é obrigatória com MCP_ENABLED=true');

  const sessions = new Map<string, McpSession>();

  app.addHook('onRequest', async (request, reply) => {
    if (!isValidApiKey(extractApiKey(request), apiKey)) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'api_key ausente ou inválida para o /mcp.');
    }
  });

  app.addHook('onClose', async () => {
    await Promise.all([...sessions.values()].map(({ transport }) => transport.close()));
    sessions.clear();
  });

  const handle = async (request: FastifyRequest, reply: FastifyReply) => {
    const sessionId = request.headers['mcp-session-id'];
    const existing = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;

    if (existing) {
      reply.hijack();
      await existing.transport.handleRequest(request.raw, reply.raw, request.body);
      return;
    }

    if (request.method !== 'POST' || !isInitializeRequest(request.body)) {
      return sendError(
        reply,
        400,
        'MCP_SESSION_REQUIRED',
        'Sessão MCP ausente ou expirada: envie um initialize sem mcp-session-id.',
      );
    }

    const state: McpSessionState = {};
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { transport, state });
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };

    const server = createMcpServer(app, state);
    await server.connect(transport);

    reply.hijack();
    await transport.handleRequest(request.raw, reply.raw, request.body);
  };

  app.route({ method: ['GET', 'POST', 'DELETE'], url: '/mcp', handler: handle });
}
