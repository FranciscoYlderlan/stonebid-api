import type { Lot } from '../../domain/entities/lot.ts';
import type { LotsRepository } from '../../domain/repositories/lots-repository.ts';
import type { WalletRepository } from '../../domain/repositories/wallet-repository.ts';
import type { DueLotsSettler } from './settle-lot.ts';

export interface AuctioneerLots {
  lots: Lot[];
  /** Total recebido (RF-24): soma dos CREDIT de liquidação do leiloeiro. */
  totalReceivedCents: number;
  now: Date;
}

/**
 * Painel do leiloeiro (RF-25): só os lotes dele, inclusive cancelados, e o total recebido.
 * Lotes vencidos são liquidados na leitura (AD-08) antes de somar.
 */
export class ListAuctioneerLotsUseCase {
  constructor(
    private readonly lotsRepository: LotsRepository,
    private readonly walletRepository: WalletRepository,
    private readonly settler: DueLotsSettler,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(auctioneerId: string): Promise<AuctioneerLots> {
    const lots = await this.settler.settleIfDue(
      await this.lotsRepository.listByAuctioneer(auctioneerId),
    );
    const totalReceivedCents = await this.walletRepository.sumSettlementCredits(auctioneerId);
    return { lots, totalReceivedCents, now: this.clock() };
  }
}
