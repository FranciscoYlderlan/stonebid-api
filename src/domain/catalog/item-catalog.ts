import type { CatalogItem, ItemImage } from '../entities/item.ts';

export interface ItemSearchPage {
  items: CatalogItem[];
  page: number;
  totalPages: number;
}

/**
 * Porta para a API pública de itens (AD-06). A implementação mora em `infra/external/`.
 * Falha de rede, timeout ou resposta inválida → ExternalApiUnavailableError.
 */
export interface ItemCatalog {
  /** Busca itens com imagem. `page` começa em 1. */
  search(query: string, page: number): Promise<ItemSearchPage>;
  /** Item pelo id da API externa; `null` se não existe ou não tem imagem utilizável. */
  findById(externalId: string): Promise<CatalogItem | null>;
  /** Baixa a imagem do item. Acima de `maxBytes` → ItemImageTooLargeError. */
  downloadImage(imageUrl: string, maxBytes: number): Promise<ItemImage>;
}
