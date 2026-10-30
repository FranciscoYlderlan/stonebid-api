import type { FastifyInstance } from 'fastify';
import { listLotBidsController } from '../controllers/bids/list-lot-bids-controller.ts';
import { listMyBidsController } from '../controllers/bids/list-my-bids-controller.ts';
import { placeBidController } from '../controllers/bids/place-bid-controller.ts';
import { requireRole } from '../middlewares/require-role.ts';

/** Lances (RF-33, RF-70): só licitante dá lance (RN-06); o histórico é público e sem dado pessoal. */
export async function bidsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/lots/:id/bids', { preHandler: requireRole('BIDDER') }, placeBidController);
  app.get('/lots/:id/bids', listLotBidsController);
  app.get('/me/bids', { preHandler: requireRole('BIDDER') }, listMyBidsController);
}
