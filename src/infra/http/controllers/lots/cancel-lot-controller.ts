import type { FastifyReply, FastifyRequest } from 'fastify';
import type { LotBidsReader } from '../../../../domain/repositories/lot-bids-reader.ts';
import { makeCancelLotUseCase } from '../../../factories/make-cancel-lot-use-case.ts';
import { toLotDto } from '../../presenters/lot-presenter.ts';
import { lotIdParamsSchema } from '../../schemas/lot-schemas.ts';

export function cancelLotController(bidsReader: LotBidsReader) {
  return async function handler(request: FastifyRequest, reply: FastifyReply) {
    const { id } = lotIdParamsSchema.parse(request.params);
    const { lot, now } = await makeCancelLotUseCase(bidsReader).execute({
      lotId: id,
      auctioneerId: request.user.sub,
    });
    return reply.status(200).send(toLotDto(lot, now));
  };
}
