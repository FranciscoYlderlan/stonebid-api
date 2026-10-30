import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { env } from './env/index.ts';
import type { ItemCatalog } from './domain/catalog/item-catalog.ts';
import type { LotBidsReader } from './domain/repositories/lot-bids-reader.ts';
import { makeItemCatalog } from './infra/external/make-item-catalog.ts';
import { registerErrorHandler } from './infra/http/errors/error-handler.ts';
import { TooManyRequestsError } from './infra/http/errors/too-many-requests-error.ts';
import { authRoutes } from './infra/http/routes/auth-routes.ts';
import { healthRoutes } from './infra/http/routes/health-routes.ts';
import { itemsRoutes } from './infra/http/routes/items-routes.ts';
import { lotsRoutes } from './infra/http/routes/lots-routes.ts';
import { walletRoutes } from './infra/http/routes/wallet-routes.ts';
import { mcpPlugin } from './infra/mcp/plugin.ts';
import { NoBidsYetReader } from './infra/repositories/no-bids-yet-reader.ts';

export interface BuildAppOptions {
  logger?: FastifyServerOptions['logger'];
  mcpEnabled?: boolean;
  /** API de itens (AD-06). Padrão: Art Institute of Chicago pelo ambiente; os testes trocam. */
  itemCatalog?: ItemCatalog;
  /** Leitura de lances (RN-12, RN-19). Padrão: nenhum lance até o I2; os testes trocam. */
  lotBidsReader?: LotBidsReader;
}

/** Monta a aplicação sem escutar porta (usado pelo server.ts e pelos testes E2E). */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? (env.NODE_ENV === 'test' ? false : { level: 'info' }),
  });

  registerErrorHandler(app);

  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  });

  await app.register(jwt, { secret: env.JWT_SECRET });

  // Limite só nas rotas que pedem (`config.rateLimit`), por IP, em memória por instância.
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) => new TooManyRequestsError(context.after),
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(walletRoutes);

  const catalog = options.itemCatalog ?? makeItemCatalog();
  const bidsReader = options.lotBidsReader ?? new NoBidsYetReader();
  await app.register(itemsRoutes, { catalog, bidsReader });
  await app.register(lotsRoutes, { catalog, bidsReader });

  if (options.mcpEnabled ?? env.MCP_ENABLED) {
    await app.register(mcpPlugin);
  }

  return app;
}
