import type { FastifyReply, FastifyRequest } from 'fastify';
import { makeGetLotUseCase } from '../../../factories/make-get-lot-use-case.ts';
import { toLotDto } from '../../presenters/lot-presenter.ts';
import { lotIdParamsSchema } from '../../schemas/lot-schemas.ts';

export async function getLotController(request: FastifyRequest, reply: FastifyReply) {
  const { id } = lotIdParamsSchema.parse(request.params);
  const { lot, now } = await makeGetLotUseCase().execute(id);
  return reply.status(200).send({ serverTime: now.toISOString(), lot: toLotDto(lot, now) });
}
