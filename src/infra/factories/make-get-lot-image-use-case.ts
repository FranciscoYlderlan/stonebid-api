import { GetLotImageUseCase } from '../../application/use-cases/get-lot-image.ts';
import { PrismaLotsRepository } from '../repositories/prisma/prisma-lots-repository.ts';

export function makeGetLotImageUseCase(): GetLotImageUseCase {
  return new GetLotImageUseCase(new PrismaLotsRepository());
}
