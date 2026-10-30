import { ListAuctioneerLotsUseCase } from '../../application/use-cases/list-auctioneer-lots.ts';
import { PrismaLotsRepository } from '../repositories/prisma/prisma-lots-repository.ts';

export function makeListAuctioneerLotsUseCase(): ListAuctioneerLotsUseCase {
  return new ListAuctioneerLotsUseCase(new PrismaLotsRepository());
}
