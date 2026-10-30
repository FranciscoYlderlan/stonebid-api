import { computeBalance, type WalletBalance } from '../../domain/entities/wallet.ts';
import type { WalletRepository } from '../../domain/repositories/wallet-repository.ts';

export class GetWalletUseCase {
  constructor(private readonly walletRepository: WalletRepository) {}

  async execute(userId: string): Promise<{ wallet: WalletBalance }> {
    const totals = await this.walletRepository.totalsByType(userId);
    return { wallet: computeBalance(totals) };
  }
}
