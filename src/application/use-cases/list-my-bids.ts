import { getLotStatus, type Lot } from '../../domain/entities/lot.ts';
import type { BidsRepository } from '../../domain/repositories/bids-repository.ts';
import type { LotsRepository } from '../../domain/repositories/lots-repository.ts';
import type { DueLotsSettler } from './settle-lot.ts';

export const myBidPositions = ['LEADING', 'OUTBID', 'WON', 'LOST', 'CANCELED'] as const;
export type MyBidPosition = (typeof myBidPositions)[number];

export interface MyBidItem {
  lot: Lot;
  myMaxBidCents: number;
  position: MyBidPosition;
  /** Link do comprovante, só quando o licitante venceu. */
  receiptPublicId: string | null;
}

/** Situação do licitante no lote, pelo relógio do servidor e pelo resultado da liquidação. */
export function myBidPosition(lot: Lot, bidderId: string, now: Date): MyBidPosition {
  const status = getLotStatus(lot, now);
  const leads = lot.leaderId === bidderId;
  if (status === 'CANCELED') return 'CANCELED';
  if (status === 'ENDED') return leads && lot.result !== 'NO_WINNER' ? 'WON' : 'LOST';
  return leads ? 'LEADING' : 'OUTBID';
}

/**
 * Meus lances: lotes em que o licitante deu lance, do lance mais recente ao mais antigo,
 * com o maior lance dele e a situação. Lotes vencidos são liquidados na leitura (AD-08).
 */
export class ListMyBidsUseCase {
  constructor(
    private readonly bidsRepository: BidsRepository,
    private readonly lotsRepository: LotsRepository,
    private readonly settler: DueLotsSettler,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(bidderId: string): Promise<{ items: MyBidItem[]; now: Date }> {
    const summaries = await this.bidsRepository.listLotsByBidder(bidderId);
    const found = await this.lotsRepository.findManyByIds(summaries.map((s) => s.lotId));
    const lots = new Map((await this.settler.settleIfDue(found)).map((lot) => [lot.id, lot]));
    const now = this.clock();

    const items: MyBidItem[] = [];
    for (const summary of summaries) {
      const lot = lots.get(summary.lotId);
      if (!lot) continue;
      const position = myBidPosition(lot, bidderId, now);
      items.push({
        lot,
        myMaxBidCents: summary.maxAmountCents,
        position,
        receiptPublicId: position === 'WON' ? lot.receiptPublicId : null,
      });
    }
    return { items, now };
  }
}
