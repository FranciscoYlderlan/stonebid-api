import type { FastifyReply } from 'fastify';
import type { User } from '../../../../domain/entities/user.ts';

export const TOKEN_EXPIRES_IN = '7d';

export function signToken(reply: FastifyReply, user: User): Promise<string> {
  return reply.jwtSign({ sub: user.id, role: user.role }, { expiresIn: TOKEN_EXPIRES_IN });
}
