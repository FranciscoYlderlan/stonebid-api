import { CreateLotUseCase } from '../../application/use-cases/create-lot.ts';
import type { ItemCatalog } from '../../domain/catalog/item-catalog.ts';
import { env } from '../../env/index.ts';
import { PrismaLotsRepository } from '../repositories/prisma/prisma-lots-repository.ts';

export function makeCreateLotUseCase(catalog: ItemCatalog): CreateLotUseCase {
  return new CreateLotUseCase(new PrismaLotsRepository(), catalog, {
    imageMaxBytes: env.LOT_IMAGE_MAX_BYTES,
  });
}
