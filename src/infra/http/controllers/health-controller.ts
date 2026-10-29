import type { FastifyReply, FastifyRequest } from 'fastify';
import { checkDatabase } from '../../repositories/prisma/prisma-database-health.ts';
import { sendError } from '../errors/error-handler.ts';

export async function healthController(request: FastifyRequest, reply: FastifyReply) {
  try {
    await checkDatabase();
    return reply.status(200).send({ status: 'ok' });
  } catch (error) {
    request.log.error(error, 'health: banco indisponível');
    return sendError(reply, 503, 'SERVICE_UNAVAILABLE', 'Banco de dados indisponível.');
  }
}
