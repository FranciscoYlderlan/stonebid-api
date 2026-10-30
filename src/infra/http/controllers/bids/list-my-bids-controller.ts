import type { FastifyReply, FastifyRequest } from 'fastify';
import { makeListMyBidsUseCase } from '../../../factories/make-list-my-bids-use-case.ts';
import { toLotDto } from '../../presenters/lot-presenter.ts';

export async function listMyBidsController(request: FastifyRequest, reply: FastifyReply) {
  const { items, now } = await makeListMyBidsUseCase().execute(request.user.sub);
  return reply.status(200).send({
    serverTime: now.toISOString(),
    items: items.map((item) => ({
      lot: toLotDto(item.lot, now),
      myMaxBidCents: item.myMaxBidCents,
      position: item.position,
      receiptPublicId: item.receiptPublicId,
    })),
  });
}
