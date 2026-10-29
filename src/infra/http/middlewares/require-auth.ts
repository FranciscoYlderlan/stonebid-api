import type { FastifyReply, FastifyRequest } from 'fastify';
import { UnauthorizedError } from '../../../domain/errors/unauthorized-error.ts';

/** preHandler: exige `Authorization: Bearer <token>` válido. Preenche `request.user`. */
export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    throw new UnauthorizedError();
  }
}
