import { GetWalletUseCase } from '../../application/use-cases/get-wallet.ts';
import { PrismaWalletRepository } from '../repositories/prisma/prisma-wallet-repository.ts';

export function makeGetWalletUseCase(): GetWalletUseCase {
  return new GetWalletUseCase(new PrismaWalletRepository());
}
