import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { env } from './env/index.ts';
import type { ItemCatalog } from './domain/catalog/item-catalog.ts';
import type { LotBidsReader } from './domain/repositories/lot-bids-reader.ts';
import { makeItemCatalog } from './infra/external/make-item-catalog.ts';
import { registerErrorHandler } from './infra/http/errors/error-handler.ts';
import {
  retryAfterSeconds,
  TooManyRequestsError,
} from './infra/http/errors/too-many-requests-error.ts';
import { authRoutes } from './infra/http/routes/auth-routes.ts';
import { bidsRoutes } from './infra/http/routes/bids-routes.ts';
import { healthRoutes } from './infra/http/routes/health-routes.ts';
import { itemsRoutes } from './infra/http/routes/items-routes.ts';
import { lotsRoutes } from './infra/http/routes/lots-routes.ts';
import { walletRoutes } from './infra/http/routes/wallet-routes.ts';
import { mcpPlugin } from './infra/mcp/plugin.ts';
import { PrismaLotBidsReader } from './infra/repositories/prisma/prisma-lot-bids-reader.ts';

/**
 * Proxy confiável para o `request.ip` (chave do limite por IP): só o salto imediato quando ele vem
 * da faixa link-local `169.254.0.0/16`, de onde o proxy interno do Cloud Run entrega a requisição.
 * Nesse caso vale a última entrada do `X-Forwarded-For`, a que o Google Front End acrescenta com o
 * IP real do cliente; o que o cliente mandar no cabeçalho fica à esquerda e é ignorado. Conexão de
 * outro endereço (local, testes, acesso direto) usa o próprio socket. O Fastify 5.12.1+ desliga a
 * forma numérica (`trustProxy: 1`) por não validar o endereço do salto (CVE-2026-16732).
 */
export const TRUSTED_PROXY = '169.254.0.0/16';

/**
 * Cabeçalhos do `@fastify/rate-limit` que o navegador pode ler numa resposta CORS (o frontend mostra
 * a espera do 429). Só esses: o resto segue fora do `Access-Control-Expose-Headers`.
 */
export const RATE_LIMIT_EXPOSED_HEADERS = [
  'retry-after',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
];

export interface BuildAppOptions {
  logger?: FastifyServerOptions['logger'];
  mcpEnabled?: boolean;
  /** API de itens (AD-06). Padrão: Art Institute of Chicago pelo ambiente; os testes trocam. */
  itemCatalog?: ItemCatalog;
  /** Leitura de lances (RN-19). Padrão: os lances do banco; os testes podem trocar. */
  lotBidsReader?: LotBidsReader;
}

/** Monta a aplicação sem escutar porta (usado pelo server.ts e pelos testes E2E). */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: TRUSTED_PROXY,
    logger: options.logger ?? (env.NODE_ENV === 'test' ? false : { level: 'info' }),
  });

  registerErrorHandler(app);

  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    exposedHeaders: RATE_LIMIT_EXPOSED_HEADERS,
  });

  await app.register(jwt, { secret: env.JWT_SECRET });

  // Limite só nas rotas que pedem (`config.rateLimit`), por IP real (`TRUSTED_PROXY`), em memória
  // por instância.
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) =>
      new TooManyRequestsError(retryAfterSeconds(context.ttl)),
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(walletRoutes);

  const catalog = options.itemCatalog ?? makeItemCatalog();
  const bidsReader = options.lotBidsReader ?? new PrismaLotBidsReader();
  await app.register(itemsRoutes, { catalog, bidsReader });
  await app.register(lotsRoutes, { catalog, bidsReader });
  await app.register(bidsRoutes);

  if (options.mcpEnabled ?? env.MCP_ENABLED) {
    await app.register(mcpPlugin);
  }

  return app;
}
