import type { Lot } from '../../domain/entities/lot.ts';
import { LotNotFoundError } from '../../domain/errors/lot-not-found-error.ts';
import type { LotsRepository } from '../../domain/repositories/lots-repository.ts';

/** Detalhe público do lote; cancelado também volta (com status CANCELED). */
export class GetLotUseCase {
  constructor(
    private readonly lotsRepository: LotsRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(id: string): Promise<{ lot: Lot; now: Date }> {
    const lot = await this.lotsRepository.findById(id);
    if (!lot) throw new LotNotFoundError();
    return { lot, now: this.clock() };
  }
}
