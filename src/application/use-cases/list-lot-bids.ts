import type { PublicBid } from '../../domain/entities/bid.ts';
import { LotNotFoundError } from '../../domain/errors/lot-not-found-error.ts';
import { pseudonymFor } from '../../domain/integrity/bid-chain.ts';
import type { BidsRepository } from '../../domain/repositories/bids-repository.ts';
import type { LotsRepository } from '../../domain/repositories/lots-repository.ts';

/**
 * Histórico público de lances do lote (RF-33, RN-15): do mais novo para o mais antigo, com o
 * pseudônimo do licitante no lugar do id, sem nome, e-mail, hash nem selo.
 */
export class ListLotBidsUseCase {
  constructor(
    private readonly lotsRepository: LotsRepository,
    private readonly bidsRepository: BidsRepository,
    private readonly pseudonymSecret: string,
  ) {}

  async execute(lotId: string): Promise<{ items: PublicBid[] }> {
    const lot = await this.lotsRepository.findById(lotId);
    if (!lot) throw new LotNotFoundError();
    const bids = await this.bidsRepository.listByLot(lot.id);
    return {
      items: bids.map((bid) => ({
        seq: bid.seq,
        lotId: bid.lotId,
        amountCents: bid.amountCents,
        pseudonym: pseudonymFor(this.pseudonymSecret, bid.lotId, bid.bidderId),
        createdAt: bid.createdAt,
      })),
    };
  }
}
