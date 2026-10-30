import { SearchItemsUseCase } from '../../application/use-cases/search-items.ts';
import type { ItemCatalog } from '../../domain/catalog/item-catalog.ts';

export function makeSearchItemsUseCase(catalog: ItemCatalog): SearchItemsUseCase {
  return new SearchItemsUseCase(catalog);
}
