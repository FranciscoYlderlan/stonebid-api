import { isDueForSettlement, type Lot } from '../../domain/entities/lot.ts';
import { noLotEvents, type LotEventsPublisher } from '../lot-events-publisher.ts';
import type { Receipt } from '../../domain/entities/receipt.ts';
import {
  newReceiptPublicId,
  pseudonymFor,
  sealReceipt,
  type ChainSecrets,
} from '../../domain/integrity/bid-chain.ts';
import type { LotsRepository } from '../../domain/repositories/lots-repository.ts';
import type {
  SettlementPlan,
  SettlementRepository,
  SettlementResult,
} from '../../domain/repositories/settlement-repository.ts';

/** Quantos lotes vencidos o agendador liquida por rodada (AD-08). */
export const SETTLE_BATCH_LIMIT = 20;

/** Liquida, na leitura, os lotes vencidos de uma lista (AD-08). */
export interface DueLotsSettler {
  /** Devolve a mesma lista, na mesma ordem, com os lotes vencidos já liquidados. */
  settleIfDue(lots: readonly Lot[]): Promise<Lot[]>;
}

/**
 * Liquidação (RN-11, AD-08), idempotente: com o lote travado, confere se está vencido, não
 * cancelado e ainda sem `settledAt`. Com vencedor: RELEASE + DEBIT do valor final na carteira do
 * vencedor, CREDIT na do leiloeiro e o comprovante selado (M-12), tudo numa transação; o lote fica
 * `SOLD`. Sem lances: `NO_WINNER`, sem movimento nem comprovante. Vencedor e valor final são o
 * líder e o lance atual, que congelam aqui junto com a cabeça da cadeia.
 */
export class SettleLotUseCase implements DueLotsSettler {
  constructor(
    private readonly settlementRepository: SettlementRepository,
    private readonly lotsRepository: LotsRepository,
    private readonly secrets: ChainSecrets,
    private readonly clock: () => Date = () => new Date(),
    private readonly lotEvents: LotEventsPublisher = noLotEvents,
  ) {}

  /** Liquida um lote se estiver vencido. `null` se o lote não existe. */
  async execute(lotId: string): Promise<SettlementResult | null> {
    const result = await this.settlementRepository.settle(lotId, (lot) => this.plan(lot));
    // Só quem liquidou avisa a sala, depois do COMMIT (AD-04); os disparos repetidos não.
    if (result?.settled) this.lotEvents.publish(lotId, 'settled');
    return result;
  }

  /** Rodada do agendador: liquida até `limit` lotes vencidos. Devolve só os que liquidou agora. */
  async settleDue(limit = SETTLE_BATCH_LIMIT): Promise<SettlementResult[]> {
    const ids = await this.lotsRepository.listDueForSettlement(this.clock(), limit);
    const settled: SettlementResult[] = [];
    for (const id of ids) {
      const result = await this.execute(id);
      if (result?.settled) settled.push(result);
    }
    return settled;
  }

  async settleIfDue(lots: readonly Lot[]): Promise<Lot[]> {
    const now = this.clock();
    const result: Lot[] = [];
    for (const lot of lots) {
      if (!isDueForSettlement(lot, now)) {
        result.push(lot);
        continue;
      }
      const settled = await this.execute(lot.id);
      result.push(settled?.lot ?? lot);
    }
    return result;
  }

  /** Decide com o lote travado; a hora é lida sob a trava. */
  private plan(lot: Lot): SettlementPlan | null {
    const now = this.clock();
    if (!isDueForSettlement(lot, now)) return null;

    if (lot.leaderId === null || lot.currentBidCents === null || lot.headHash === null) {
      return { settledAt: now, result: 'NO_WINNER', receipt: null };
    }

    const fields = {
      publicId: newReceiptPublicId(),
      lotId: lot.id,
      winnerPseudonym: pseudonymFor(this.secrets.pseudonymSecret, lot.id, lot.leaderId),
      amountCents: lot.currentBidCents,
      settledAt: now,
      bidCount: lot.headSeq,
      finalHash: lot.headHash,
    };
    const receipt: Receipt = { ...fields, seal: sealReceipt(this.secrets.sealSecret, fields) };
    return { settledAt: now, result: 'SOLD', receipt };
  }
}
