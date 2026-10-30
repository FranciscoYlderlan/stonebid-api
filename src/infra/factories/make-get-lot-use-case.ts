import { GetLotUseCase } from '../../application/use-cases/get-lot.ts';
import { PrismaLotsRepository } from '../repositories/prisma/prisma-lots-repository.ts';
import { makeSettleLotUseCase } from './make-settle-lot-use-case.ts';

export function makeGetLotUseCase(): GetLotUseCase {
  return new GetLotUseCase(new PrismaLotsRepository(), makeSettleLotUseCase());
}
