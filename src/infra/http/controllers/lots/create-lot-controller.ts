import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ItemCatalog } from '../../../../domain/catalog/item-catalog.ts';
import { makeCreateLotUseCase } from '../../../factories/make-create-lot-use-case.ts';
import { toLotDto } from '../../presenters/lot-presenter.ts';
import { createLotBodySchema } from '../../schemas/lot-schemas.ts';

export function createLotController(catalog: ItemCatalog) {
  return async function handler(request: FastifyRequest, reply: FastifyReply) {
    const body = createLotBodySchema.parse(request.body);
    const { lot, now } = await makeCreateLotUseCase(catalog).execute({
      auctioneerId: request.user.sub,
      externalId: body.externalId,
      startingBidCents: body.startingBidCents,
      minIncrementCents: body.minIncrementCents,
      startsAt: new Date(body.startsAt),
      endsAt: new Date(body.endsAt),
    });
    return reply.status(201).send(toLotDto(lot, now));
  };
}
