import type { ItemCatalog } from '../../domain/catalog/item-catalog.ts';
import { env } from '../../env/index.ts';
import { ArticItemCatalog } from './artic-item-catalog.ts';

/** Catálogo de itens configurado pelo ambiente (ITEMS_API_*). */
export function makeItemCatalog(): ItemCatalog {
  return new ArticItemCatalog({
    apiBaseUrl: env.ITEMS_API_BASE_URL.replace(/\/+$/, ''),
    iiifBaseUrl: env.ITEMS_IIIF_BASE_URL,
    timeoutMs: env.ITEMS_API_TIMEOUT_MS,
  });
}
