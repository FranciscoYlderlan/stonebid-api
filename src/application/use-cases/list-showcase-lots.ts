import type { Lot } from '../../domain/entities/lot.ts';
import type { LotsRepository } from '../../domain/repositories/lots-repository.ts';

/** Quantos encerrados a vitrine mostra (os mais recentes). */
export const SHOWCASE_ENDED_LIMIT = 30;

export interface ShowcaseLots {
  now: Date;
  live: Lot[];
  scheduled: Lot[];
  ended: Lot[];
}

/** Vitrine pública (RF-10): três seções pelo relógio do servidor, sem cancelados. */
export class ListShowcaseLotsUseCase {
  constructor(
    private readonly lotsRepository: LotsRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(): Promise<ShowcaseLots> {
    const now = this.clock();
    const [live, scheduled, ended] = await Promise.all([
      this.lotsRepository.listLive(now),
      this.lotsRepository.listScheduled(now),
      this.lotsRepository.listEnded(now, SHOWCASE_ENDED_LIMIT),
    ]);
    return { now, live, scheduled, ended };
  }
}
