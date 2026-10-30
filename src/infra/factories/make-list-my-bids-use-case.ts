import { ListMyBidsUseCase } from '../../application/use-cases/list-my-bids.ts';
import { PrismaBidsRepository } from '../repositories/prisma/prisma-bids-repository.ts';
import { PrismaLotsRepository } from '../repositories/prisma/prisma-lots-repository.ts';
import { makeSettleLotUseCase } from './make-settle-lot-use-case.ts';

export function makeListMyBidsUseCase(): ListMyBidsUseCase {
  return new ListMyBidsUseCase(
    new PrismaBidsRepository(),
    new PrismaLotsRepository(),
    makeSettleLotUseCase(),
  );
}
