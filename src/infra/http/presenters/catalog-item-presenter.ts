import type { ItemSearchPage } from '../../../domain/catalog/item-catalog.ts';
import type { CatalogItem, ItemAttributes } from '../../../domain/entities/item.ts';

export interface CatalogItemHttp {
  externalId: string;
  title: string;
  /** Relativa à API: a miniatura sai pelo servidor, nunca direto do IIIF (RF-20). */
  imageUrl: string;
  attributes: ItemAttributes;
}

export function thumbnailPath(imageId: string): string {
  return `/items/images/${encodeURIComponent(imageId)}/thumbnail`;
}

export function presentCatalogItem(item: CatalogItem): CatalogItemHttp {
  return {
    externalId: item.externalId,
    title: item.title,
    imageUrl: thumbnailPath(item.imageId),
    attributes: item.attributes,
  };
}

export function presentItemSearchPage(page: ItemSearchPage) {
  return {
    items: page.items.map(presentCatalogItem),
    page: page.page,
    totalPages: page.totalPages,
  };
}
