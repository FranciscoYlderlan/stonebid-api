import type { FastifyInstance, HTTPMethods } from 'fastify';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface RouteCall {
  method: HTTPMethods;
  url: string;
  body?: unknown;
  /** Token JWT do usuário de teste (vai só no inject interno, nunca no /mcp). */
  token?: string;
  /** Cabeçalhos extras da rota (ex.: Idempotency-Key). */
  headers?: Record<string, string>;
}

export interface RouteResult {
  status: number;
  body: unknown;
}

/**
 * Executa a rota real no mesmo processo com `app.inject()`: passa por validação, auth,
 * tratamento de erro e serialização de verdade.
 */
export async function callRoute(app: FastifyInstance, call: RouteCall): Promise<RouteResult> {
  const headers: Record<string, string> = { ...call.headers };
  if (call.token) headers.authorization = `Bearer ${call.token}`;

  const response = await app.inject({
    method: call.method,
    url: call.url,
    headers,
    ...(call.body !== undefined ? { payload: call.body as object } : {}),
  });

  let body: unknown = response.body;
  try {
    body = response.json();
  } catch {
    // resposta sem JSON: devolve o texto como veio
  }

  return { status: response.statusCode, body };
}

/** Converte o resultado da rota em resultado de tool: status + corpo em JSON; erro HTTP vira isError. */
export function toToolResult(result: RouteResult): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    structuredContent: result as unknown as Record<string, unknown>,
    isError: result.status >= 400,
  };
}
