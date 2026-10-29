import type { FastifyInstance } from 'fastify';
import { healthController } from '../controllers/health-controller.ts';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', healthController);
}
