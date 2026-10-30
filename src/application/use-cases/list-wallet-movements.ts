import type { WalletMovement } from '../../domain/entities/wallet.ts';
import type { WalletRepository } from '../../domain/repositories/wallet-repository.ts';

export class ListWalletMovementsUseCase {
  constructor(private readonly walletRepository: WalletRepository) {}

  async execute(userId: string): Promise<{ movements: WalletMovement[] }> {
    return { movements: await this.walletRepository.listByUser(userId) };
  }
}
