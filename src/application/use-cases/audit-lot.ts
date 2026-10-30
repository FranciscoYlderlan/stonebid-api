import type { Lot } from '../../domain/entities/lot.ts';
import type { Receipt } from '../../domain/entities/receipt.ts';
import { LotNotFoundError } from '../../domain/errors/lot-not-found-error.ts';
import type { ChainBid, ChainSecrets } from '../../domain/integrity/bid-chain.ts';
import {
  auditLot,
  type AuditMovement,
  type AuditResult,
} from '../../domain/integrity/lot-audit.ts';
import type { LotsRepository } from '../../domain/repositories/lots-repository.ts';
import type { DueLotsSettler } from './settle-lot.ts';

/** Fotografia coerente do lote para a auditoria: tudo lido no mesmo instante do banco. */
export interface LotAuditSnapshot {
  lot: Lot;
  /** Lances em ordem de `seq`, como estão no banco. */
  bids: ChainBid[];
  receipt: Receipt | null;
  debits: AuditMovement[];
  credits: AuditMovement[];
}

/** Porta de leitura da auditoria; `null` se o lote não existe. */
export interface LotAuditReader {
  load(lotId: string): Promise<LotAuditSnapshot | null>;
}

export interface LotAuditReport extends AuditResult {
  lot: Lot;
  bids: ChainBid[];
  /** Hora do recálculo (RF-61: o veredito nunca é guardado). */
  checkedAt: Date;
}

/**
 * Auditoria pública do lote (RF-60, RF-61): lote vencido é liquidado na leitura, como no
 * `GET /lots/:id` (AD-08); depois lances, cabeça, comprovante e extrato são lidos juntos e
 * conferidos de novo. Vale para lote ao vivo, encerrado, liquidado e cancelado.
 */
export class AuditLotUseCase {
  constructor(
    private readonly lotsRepository: LotsRepository,
    private readonly settler: DueLotsSettler,
    private readonly auditReader: LotAuditReader,
    private readonly secrets: ChainSecrets,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(lotId: string): Promise<LotAuditReport> {
    const found = await this.lotsRepository.findById(lotId);
    if (!found) throw new LotNotFoundError();
    await this.settler.settleIfDue([found]);

    const snapshot = await this.auditReader.load(found.id);
    if (!snapshot) throw new LotNotFoundError();

    const result = auditLot(
      {
        lotId: snapshot.lot.id,
        bids: snapshot.bids,
        head: {
          headSeq: snapshot.lot.headSeq,
          headHash: snapshot.lot.headHash,
          headSeal: snapshot.lot.headSeal,
        },
        currentBidCents: snapshot.lot.currentBidCents,
        leaderId: snapshot.lot.leaderId,
        auctioneerId: snapshot.lot.auctioneerId,
        settledAt: snapshot.lot.settledAt,
        result: snapshot.lot.result,
        receipt: snapshot.receipt,
        debits: snapshot.debits,
        credits: snapshot.credits,
      },
      this.secrets,
    );
    return { ...result, lot: snapshot.lot, bids: snapshot.bids, checkedAt: this.clock() };
  }
}
