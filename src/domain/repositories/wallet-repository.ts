import type { MovementTotals, WalletMovement } from '../entities/wallet.ts';

export interface CreateDepositInput {
  userId: string;
  amountCents: number;
  idempotencyKey: string;
}

export interface WalletRepository {
  /** Soma dos valores por tipo de movimento do usuário. */
  totalsByType(userId: string): Promise<Partial<MovementTotals>>;
  /** Soma dos CREDIT de liquidação do usuário (total recebido pelo leiloeiro, RF-24). */
  sumSettlementCredits(userId: string): Promise<number>;
  /** Extrato do usuário, mais recentes primeiro. */
  listByUser(userId: string): Promise<WalletMovement[]>;
  findByIdempotencyKey(userId: string, idempotencyKey: string): Promise<WalletMovement | null>;
  /**
   * Insere o depósito. Se a chave já existe para o usuário (inclusive numa corrida entre duas
   * requisições), não insere e devolve o movimento existente com `created: false`.
   */
  createDeposit(data: CreateDepositInput): Promise<{ movement: WalletMovement; created: boolean }>;
}
