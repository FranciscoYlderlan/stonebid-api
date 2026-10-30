import type { FastifyInstance } from 'fastify';
import type { ItemCatalog } from '../../../domain/catalog/item-catalog.ts';
import { getItemThumbnailController } from '../controllers/items/get-item-thumbnail-controller.ts';
import { searchItemsController } from '../controllers/items/search-items-controller.ts';
import { requireRole } from '../middlewares/require-role.ts';

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
  app.get('/items/images/:imageId/thumbnail', getItemThumbnailController(options.catalog));
}
