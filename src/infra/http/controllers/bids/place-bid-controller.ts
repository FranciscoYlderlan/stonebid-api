import type { FastifyReply, FastifyRequest } from 'fastify';
import { makePlaceBidUseCase } from '../../../factories/make-place-bid-use-case.ts';
import { toBidDto } from '../../presenters/bid-presenter.ts';
import { toLotDto } from '../../presenters/lot-presenter.ts';
import { toWalletDto } from '../../presenters/wallet-presenter.ts';
import { placeBidBodySchema, placeBidHeadersSchema } from '../../schemas/bid-schemas.ts';
import { lotIdParamsSchema } from '../../schemas/lot-schemas.ts';

/** 201 no lance novo; 200 com o mesmo lance quando a Idempotency-Key se repete (RN-18). */
export async function placeBidController(request: FastifyRequest, reply: FastifyReply) {
  const { id } = lotIdParamsSchema.parse(request.params);
  const headers = placeBidHeadersSchema.parse(request.headers);
  const body = placeBidBodySchema.parse(request.body);

  const { bid, lot, wallet, created, now } = await makePlaceBidUseCase().execute({
    lotId: id,
    bidderId: request.user.sub,
    amountCents: body.amountCents,
    idempotencyKey: headers['idempotency-key'],
  });

  return reply.status(created ? 201 : 200).send({
    bid: toBidDto(bid),
    lot: toLotDto(lot, now),
    wallet: toWalletDto(wallet),
  });
}
