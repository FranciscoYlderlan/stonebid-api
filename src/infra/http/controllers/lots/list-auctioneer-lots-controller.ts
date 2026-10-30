import type { FastifyReply, FastifyRequest } from 'fastify';
import { makeListAuctioneerLotsUseCase } from '../../../factories/make-list-auctioneer-lots-use-case.ts';
import { toLotDto } from '../../presenters/lot-presenter.ts';

export async function listAuctioneerLotsController(request: FastifyRequest, reply: FastifyReply) {
  const { lots, now } = await makeListAuctioneerLotsUseCase().execute(request.user.sub);
  return reply.status(200).send({
    serverTime: now.toISOString(),
    items: lots.map((lot) => toLotDto(lot, now)),
  });
}
