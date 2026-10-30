import { GetReceiptUseCase } from '../../application/use-cases/get-receipt.ts';
import { env } from '../../env/index.ts';
import { PrismaReceiptsRepository } from '../repositories/prisma/prisma-receipts-repository.ts';

export function makeGetReceiptUseCase(): GetReceiptUseCase {
  return new GetReceiptUseCase(new PrismaReceiptsRepository(), env.SEAL_SECRET);
}
