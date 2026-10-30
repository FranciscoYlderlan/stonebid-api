import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ItemCatalog } from '../../../../domain/catalog/item-catalog.ts';
import type { LotBidsReader } from '../../../../domain/repositories/lot-bids-reader.ts';
import { makeSearchItemsUseCase } from '../../../factories/make-search-items-use-case.ts';
import { presentItemSearchPage } from '../../presenters/catalog-item-presenter.ts';
import { searchItemsQuerySchema } from '../../schemas/lot-schemas.ts';

export function searchItemsController(catalog: ItemCatalog, bidsReader: LotBidsReader) {
  return async function handler(request: FastifyRequest, reply: FastifyReply) {
    const { q, page } = searchItemsQuerySchema.parse(request.query);
    const result = await makeSearchItemsUseCase(catalog, bidsReader, {
      onAuctionLookupError: (error) =>
        request.log.warn({ err: error }, 'busca de itens sem a situação das obras (RN-19)'),
    }).execute({ query: q, page });
    return reply.status(200).send(presentItemSearchPage(result));
  };
}
