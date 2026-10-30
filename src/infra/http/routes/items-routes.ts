import type { FastifyInstance } from 'fastify';
import type { ItemCatalog } from '../../../domain/catalog/item-catalog.ts';
import { getItemThumbnailController } from '../controllers/items/get-item-thumbnail-controller.ts';
import { searchItemsController } from '../controllers/items/search-items-controller.ts';
import { requireRole } from '../middlewares/require-role.ts';

/**
 * Limite da miniatura por IP: 120/min. Uma página da grade pede 12 miniaturas; cabem 10 páginas
 * por minuto sem cache do navegador, e o `Cache-Control` de 7 dias evita repetir as mesmas.
 */
export const THUMBNAIL_RATE_LIMIT = { max: 120, timeWindow: '1 minute' } as const;

export interface ItemsRoutesOptions {
  catalog: ItemCatalog;
}

export async function itemsRoutes(
  app: FastifyInstance,
  options: ItemsRoutesOptions,
): Promise<void> {
  app.get(
    '/items/search',
    { preHandler: requireRole('AUCTIONEER') },
    searchItemsController(options.catalog),
  );

  // Pública: o `<img>` não manda o JWT do cabeçalho, e as imagens são de domínio público.
  app.get(
    '/items/images/:imageId/thumbnail',
    { config: { rateLimit: THUMBNAIL_RATE_LIMIT } },
    getItemThumbnailController(options.catalog),
  );
}
