import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ItemCatalog } from '../../../../domain/catalog/item-catalog.ts';
import { makeSearchItemsUseCase } from '../../../factories/make-search-items-use-case.ts';
import { searchItemsQuerySchema } from '../../schemas/lot-schemas.ts';

export function searchItemsController(catalog: ItemCatalog) {
  return async function handler(request: FastifyRequest, reply: FastifyReply) {
    const { q, page } = searchItemsQuerySchema.parse(request.query);
    const result = await makeSearchItemsUseCase(catalog).execute({ query: q, page });
    return reply.status(200).send(result);
  };
}
