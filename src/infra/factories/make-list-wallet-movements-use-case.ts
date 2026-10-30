import { ListWalletMovementsUseCase } from '../../application/use-cases/list-wallet-movements.ts';
import { PrismaWalletRepository } from '../repositories/prisma/prisma-wallet-repository.ts';

export function makeListWalletMovementsUseCase(): ListWalletMovementsUseCase {
  return new ListWalletMovementsUseCase(new PrismaWalletRepository());
}
