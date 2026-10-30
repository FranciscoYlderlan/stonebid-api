import { ListShowcaseLotsUseCase } from '../../application/use-cases/list-showcase-lots.ts';
import { PrismaLotsRepository } from '../repositories/prisma/prisma-lots-repository.ts';
import { makeSettleLotUseCase } from './make-settle-lot-use-case.ts';

export function makeListShowcaseLotsUseCase(): ListShowcaseLotsUseCase {
  return new ListShowcaseLotsUseCase(new PrismaLotsRepository(), makeSettleLotUseCase());
}
