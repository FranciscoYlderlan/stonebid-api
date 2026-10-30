import type { Lot, LotResult } from '../entities/lot.ts';
import type { Receipt } from '../entities/receipt.ts';

/** O que a liquidação grava: hora, resultado e, com vencedor, o comprovante selado. */
export interface SettlementPlan {
  settledAt: Date;
  result: LotResult;
  /** Só com `result = SOLD`. */
  receipt: Receipt | null;
}

export interface SettlementResult {
  lot: Lot;
  /** true só para a chamada que liquidou; as outras (já liquidado, não vencido) devolvem false. */
  settled: boolean;
}

export interface SettlementRepository {
  /**
   * Liquidação (RN-11, AD-08) numa transação que trava a linha do lote (`FOR UPDATE`), a mesma
   * trava do lance e do cancelamento. `plan` recebe o lote lido sob a trava e devolve `null` quando
   * não há o que fazer (já liquidado, cancelado ou ainda não vencido). Com vencedor, grava na mesma
   * transação o RELEASE e o DEBIT do valor final na carteira do vencedor, o CREDIT na do leiloeiro e
   * o comprovante; depois a hora e o resultado no lote. `null` se o lote não existe.
   */
  settle(
    lotId: string,
    plan: (lot: Lot) => SettlementPlan | null,
  ): Promise<SettlementResult | null>;
}
