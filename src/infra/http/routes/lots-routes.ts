import type { FastifyInstance } from 'fastify';
import type { ItemCatalog } from '../../../domain/catalog/item-catalog.ts';
import type { LotBidsReader } from '../../../domain/repositories/lot-bids-reader.ts';
import { cancelLotController } from '../controllers/lots/cancel-lot-controller.ts';
import { createLotController } from '../controllers/lots/create-lot-controller.ts';
import { getLotController } from '../controllers/lots/get-lot-controller.ts';
import { getLotImageController } from '../controllers/lots/get-lot-image-controller.ts';
import { listAuctioneerLotsController } from '../controllers/lots/list-auctioneer-lots-controller.ts';
import { listLotsController } from '../controllers/lots/list-lots-controller.ts';
import { requireRole } from '../middlewares/require-role.ts';

export interface LotsRoutesOptions {
  catalog: ItemCatalog;
  bidsReader: LotBidsReader;
}

/** Rotas públicas (vitrine, lote, imagem) nunca chamam a API de itens (RN-13). */
export async function lotsRoutes(app: FastifyInstance, options: LotsRoutesOptions): Promise<void> {
  const auctioneerOnly = { preHandler: requireRole('AUCTIONEER') };

  app.get('/lots', listLotsController);
  app.get('/lots/:id', getLotController);
  app.get('/lots/:id/image', getLotImageController);

  app.post('/lots', auctioneerOnly, createLotController(options.catalog, options.bidsReader));
  app.post('/lots/:id/cancel', auctioneerOnly, cancelLotController);
  app.get('/auctioneer/lots', auctioneerOnly, listAuctioneerLotsController);
}
