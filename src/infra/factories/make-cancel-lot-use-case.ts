import { CancelLotUseCase } from '../../application/use-cases/cancel-lot.ts';
import { PrismaLotsRepository } from '../repositories/prisma/prisma-lots-repository.ts';

export function makeCancelLotUseCase(): CancelLotUseCase {
  return new CancelLotUseCase(new PrismaLotsRepository());
}
