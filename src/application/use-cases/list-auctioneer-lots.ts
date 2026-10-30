import type { Lot } from '../../domain/entities/lot.ts';
import type { LotsRepository } from '../../domain/repositories/lots-repository.ts';

/** Painel do leiloeiro (RF-25): só os lotes dele, inclusive cancelados. */
export class ListAuctioneerLotsUseCase {
  constructor(
    private readonly lotsRepository: LotsRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(auctioneerId: string): Promise<{ lots: Lot[]; now: Date }> {
    const lots = await this.lotsRepository.listByAuctioneer(auctioneerId);
    return { lots, now: this.clock() };
  }
}
