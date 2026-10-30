import { ListShowcaseLotsUseCase } from '../../application/use-cases/list-showcase-lots.ts';
import { PrismaLotsRepository } from '../repositories/prisma/prisma-lots-repository.ts';

export function makeListShowcaseLotsUseCase(): ListShowcaseLotsUseCase {
  return new ListShowcaseLotsUseCase(new PrismaLotsRepository());
}
