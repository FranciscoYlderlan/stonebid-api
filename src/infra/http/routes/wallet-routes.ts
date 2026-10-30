import type { FastifyInstance } from 'fastify';
import { depositController } from '../controllers/wallet/deposit-controller.ts';
import { getWalletController } from '../controllers/wallet/get-wallet-controller.ts';
import { listMovementsController } from '../controllers/wallet/list-movements-controller.ts';
import { requireRole } from '../middlewares/require-role.ts';

/** Carteira do licitante (RF-40 a RF-42). O leiloeiro não tem carteira de lances: 403. */
export async function walletRoutes(app: FastifyInstance): Promise<void> {
  const onlyBidder = { preHandler: requireRole('BIDDER') };

  app.get('/wallet', onlyBidder, getWalletController);
  app.post('/wallet/deposits', onlyBidder, depositController);
  app.get('/wallet/movements', onlyBidder, listMovementsController);
}
