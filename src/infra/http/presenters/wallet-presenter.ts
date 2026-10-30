import type { WalletBalance } from '../../../domain/entities/wallet.ts';
import { env } from '../../../env/index.ts';

/** Carteira como a API devolve: o saldo derivado mais o teto do depósito (RF-40, RN-16). */
export interface WalletDto extends WalletBalance {
  depositLimitCents: number;
}

/** Mesmo formato no GET /wallet e no `wallet` da resposta do POST /wallet/deposits. */
export function toWalletDto(balance: WalletBalance): WalletDto {
  return {
    totalCents: balance.totalCents,
    committedCents: balance.committedCents,
    availableCents: balance.availableCents,
    depositLimitCents: env.DEPOSIT_LIMIT_CENTS,
  };
}
