import { GetLotUseCase } from '../../application/use-cases/get-lot.ts';
import { PrismaLotsRepository } from '../repositories/prisma/prisma-lots-repository.ts';

export function makeGetLotUseCase(): GetLotUseCase {
  return new GetLotUseCase(new PrismaLotsRepository());
}
