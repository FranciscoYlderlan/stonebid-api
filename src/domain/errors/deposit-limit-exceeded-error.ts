import { formatCentsAsBRL } from '../entities/wallet.ts';
import { AppError } from './app-error.ts';

export class DepositLimitExceededError extends AppError {
  readonly code = 'DEPOSIT_LIMIT_EXCEEDED';

  constructor(limitCents: number) {
    super(`O depósito máximo é de ${formatCentsAsBRL(limitCents)} por operação.`);
  }
}
