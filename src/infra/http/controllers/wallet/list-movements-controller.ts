import type { FastifyReply, FastifyRequest } from 'fastify';
import { toPublicMovement } from '../../../../domain/entities/wallet.ts';
import { makeListWalletMovementsUseCase } from '../../../factories/make-list-wallet-movements-use-case.ts';

export async function listMovementsController(request: FastifyRequest, reply: FastifyReply) {
  const { movements } = await makeListWalletMovementsUseCase().execute(request.user.sub);
  return reply.status(200).send({ items: movements.map(toPublicMovement) });
}
