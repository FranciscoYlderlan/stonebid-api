import type { ItemCatalog, ItemSearchPage } from '../../domain/catalog/item-catalog.ts';

export interface SearchItemsInput {
  query: string;
  page: number;
}

/** Busca do painel do leiloeiro (RF-20): a única tela que chama a API de itens (RN-13). */
export class SearchItemsUseCase {
  constructor(private readonly catalog: ItemCatalog) {}

  execute(input: SearchItemsInput): Promise<ItemSearchPage> {
    return this.catalog.search(input.query.trim(), input.page);
  }
}
