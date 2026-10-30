import type { SearchItemsResult } from '../../../application/use-cases/search-items.ts';
import type { ItemAttributes } from '../../../domain/entities/item.ts';
import type { ItemAuction } from '../../../domain/entities/item-auction.ts';

export interface CatalogItemHttp {
  externalId: string;
  title: string;
  /** Relativa à API: a miniatura sai pelo servidor, nunca direto do IIIF (RF-20). */
  imageUrl: string;
  attributes: ItemAttributes;
  /**
   * Situação da obra no Stonebid (RN-19): `SCHEDULED` ou `LIVE` = em leilão, `SOLD` = vendida
   * (arrematada), com o lote; `null` = livre para um lote novo.
   */
  auction: ItemAuction | null;
}

export function thumbnailPath(imageId: string): string {
  return `/items/images/${encodeURIComponent(imageId)}/thumbnail`;
}

export function presentCatalogItem(item: SearchItemsResult['items'][number]): CatalogItemHttp {
  return {
    externalId: item.externalId,
    title: item.title,
    imageUrl: thumbnailPath(item.imageId),
    attributes: item.attributes,
    auction: item.auction ? { status: item.auction.status, lotId: item.auction.lotId } : null,
  };
}

export function presentItemSearchPage(page: SearchItemsResult) {
  return {
    items: page.items.map(presentCatalogItem),
    page: page.page,
    totalPages: page.totalPages,
  };
}
