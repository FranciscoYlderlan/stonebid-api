import { ListAuctioneerLotsUseCase } from '../../application/use-cases/list-auctioneer-lots.ts';
import { PrismaLotsRepository } from '../repositories/prisma/prisma-lots-repository.ts';
import { PrismaWalletRepository } from '../repositories/prisma/prisma-wallet-repository.ts';
import { makeSettleLotUseCase } from './make-settle-lot-use-case.ts';

export function makeListAuctioneerLotsUseCase(): ListAuctioneerLotsUseCase {
  return new ListAuctioneerLotsUseCase(
    new PrismaLotsRepository(),
    new PrismaWalletRepository(),
    makeSettleLotUseCase(),
  );
}
