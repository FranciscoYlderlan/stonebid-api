import { CancelLotUseCase } from '../../application/use-cases/cancel-lot.ts';
import type { LotBidsReader } from '../../domain/repositories/lot-bids-reader.ts';
import { PrismaLotsRepository } from '../repositories/prisma/prisma-lots-repository.ts';

export function makeCancelLotUseCase(bidsReader: LotBidsReader): CancelLotUseCase {
  return new CancelLotUseCase(new PrismaLotsRepository(), bidsReader);
}
