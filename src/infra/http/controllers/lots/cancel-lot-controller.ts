import type { FastifyReply, FastifyRequest } from 'fastify';
import { makeCancelLotUseCase } from '../../../factories/make-cancel-lot-use-case.ts';
import { toLotDto } from '../../presenters/lot-presenter.ts';
import { lotIdParamsSchema } from '../../schemas/lot-schemas.ts';

export async function cancelLotController(request: FastifyRequest, reply: FastifyReply) {
  const { id } = lotIdParamsSchema.parse(request.params);
  const { lot, now } = await makeCancelLotUseCase().execute({
    lotId: id,
    auctioneerId: request.user.sub,
  });
  return reply.status(200).send(toLotDto(lot, now));
}
