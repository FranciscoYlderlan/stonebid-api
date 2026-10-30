import { DepositToWalletUseCase } from '../../application/use-cases/deposit-to-wallet.ts';
import { env } from '../../env/index.ts';
import { PrismaWalletRepository } from '../repositories/prisma/prisma-wallet-repository.ts';

export function makeDepositToWalletUseCase(): DepositToWalletUseCase {
  return new DepositToWalletUseCase(new PrismaWalletRepository(), env.DEPOSIT_LIMIT_CENTS);
}
