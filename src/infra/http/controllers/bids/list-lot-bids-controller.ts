import type { FastifyReply, FastifyRequest } from 'fastify';
import { makeListLotBidsUseCase } from '../../../factories/make-list-lot-bids-use-case.ts';
import { toBidHistoryItemDto } from '../../presenters/bid-presenter.ts';
import { lotIdParamsSchema } from '../../schemas/lot-schemas.ts';

export async function listLotBidsController(request: FastifyRequest, reply: FastifyReply) {
  const { id } = lotIdParamsSchema.parse(request.params);
  const { items } = await makeListLotBidsUseCase().execute(id);
  return reply.status(200).send({ items: items.map(toBidHistoryItemDto) });
}
