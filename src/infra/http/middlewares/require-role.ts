import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Role } from '../../../domain/entities/user.ts';
import { ForbiddenError } from '../../../domain/errors/forbidden-error.ts';
import { requireAuth } from './require-auth.ts';

/**
 * preHandler: exige login e um dos papéis informados (RF-02). Sem login → 401; papel errado → 403.
 * Uso: `{ preHandler: requireRole('AUCTIONEER') }`.
 */
export function requireRole(...allowed: Role[]): preHandlerAsyncHookHandler {
  return async function requireRoleHandler(request: FastifyRequest, reply: FastifyReply) {
    await requireAuth(request, reply);
    if (!allowed.includes(request.user.role)) throw new ForbiddenError();
  };
}
