import { ListLotBidsUseCase } from '../../application/use-cases/list-lot-bids.ts';
import { env } from '../../env/index.ts';
import { PrismaBidsRepository } from '../repositories/prisma/prisma-bids-repository.ts';
import { PrismaLotsRepository } from '../repositories/prisma/prisma-lots-repository.ts';

export function makeListLotBidsUseCase(): ListLotBidsUseCase {
  return new ListLotBidsUseCase(
    new PrismaLotsRepository(),
    new PrismaBidsRepository(),
    env.PSEUDONYM_SECRET,
  );
}
