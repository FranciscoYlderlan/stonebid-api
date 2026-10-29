import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { env } from './env/index.ts';
import { registerErrorHandler } from './infra/http/errors/error-handler.ts';
import { authRoutes } from './infra/http/routes/auth-routes.ts';
import { healthRoutes } from './infra/http/routes/health-routes.ts';
import { mcpPlugin } from './infra/mcp/plugin.ts';

export interface BuildAppOptions {
  logger?: FastifyServerOptions['logger'];
  mcpEnabled?: boolean;
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
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  await app.register(jwt, { secret: env.JWT_SECRET });

  await app.register(healthRoutes);
  await app.register(authRoutes);

  if (options.mcpEnabled ?? env.MCP_ENABLED) {
    await app.register(mcpPlugin);
  }

  return app;
}
