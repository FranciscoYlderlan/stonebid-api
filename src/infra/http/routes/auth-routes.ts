import type { FastifyInstance } from 'fastify';
import { loginController } from '../controllers/auth/login-controller.ts';
import { meController } from '../controllers/auth/me-controller.ts';
import { registerController } from '../controllers/auth/register-controller.ts';
import { requireAuth } from '../middlewares/require-auth.ts';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/register', registerController);
  app.post('/auth/login', loginController);
  app.get('/auth/me', { preHandler: requireAuth }, meController);
}
