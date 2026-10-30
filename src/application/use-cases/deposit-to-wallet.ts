import {
  computeBalance,
  type WalletBalance,
  type WalletMovement,
} from '../../domain/entities/wallet.ts';
import { DepositLimitExceededError } from '../../domain/errors/deposit-limit-exceeded-error.ts';
import { IdempotencyKeyReusedError } from '../../domain/errors/idempotency-key-reused-error.ts';
import type { WalletRepository } from '../../domain/repositories/wallet-repository.ts';

export interface DepositToWalletInput {
  userId: string;
  amountCents: number;
  idempotencyKey: string;
}

export interface DepositToWalletOutput {
  movement: WalletMovement;
  wallet: WalletBalance;
  /** false quando a chave já tinha sido usada: devolve o mesmo movimento, sem novo depósito. */
  created: boolean;
}

/**
 * Depósito simulado (RF-41, Q-10): valor > 0 e até o teto; sem saque.
 * Idempotente por (usuário, Idempotency-Key) (RN-18): o índice único do banco decide a corrida.
 */
export class DepositToWalletUseCase {
  constructor(
    private readonly walletRepository: WalletRepository,
    private readonly depositLimitCents: number,
  ) {}

  async execute(input: DepositToWalletInput): Promise<DepositToWalletOutput> {
    const previous = await this.walletRepository.findByIdempotencyKey(
      input.userId,
      input.idempotencyKey,
    );
    if (previous) return this.replay(previous, input);

    if (input.amountCents > this.depositLimitCents) {
      throw new DepositLimitExceededError(this.depositLimitCents);
    }

    const { movement, created } = await this.walletRepository.createDeposit(input);
    if (!created) return this.replay(movement, input);

    return { movement, wallet: await this.balance(input.userId), created: true };
  }

  private async replay(
    movement: WalletMovement,
    input: DepositToWalletInput,
  ): Promise<DepositToWalletOutput> {
    if (movement.type !== 'DEPOSIT' || movement.amountCents !== input.amountCents) {
      throw new IdempotencyKeyReusedError();
    }
    return { movement, wallet: await this.balance(input.userId), created: false };
  }

  private async balance(userId: string): Promise<WalletBalance> {
    return computeBalance(await this.walletRepository.totalsByType(userId));
  }
}
