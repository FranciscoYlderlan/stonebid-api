import {
  SearchItemsUseCase,
  type SearchItemsOptions,
} from '../../application/use-cases/search-items.ts';
import type { ItemCatalog } from '../../domain/catalog/item-catalog.ts';
import type { LotBidsReader } from '../../domain/repositories/lot-bids-reader.ts';
import { PrismaLotsRepository } from '../repositories/prisma/prisma-lots-repository.ts';

export function makeSearchItemsUseCase(
  catalog: ItemCatalog,
  bidsReader: LotBidsReader,
  options: SearchItemsOptions = {},
): SearchItemsUseCase {
  return new SearchItemsUseCase(catalog, new PrismaLotsRepository(), bidsReader, options);
}
