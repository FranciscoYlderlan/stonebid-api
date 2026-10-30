import type { Lot } from '../../domain/entities/lot.ts';
import { LotNotFoundError } from '../../domain/errors/lot-not-found-error.ts';
import type { LotsRepository } from '../../domain/repositories/lots-repository.ts';
import type { DueLotsSettler } from './settle-lot.ts';

/** Detalhe público do lote; cancelado também volta. Lote vencido é liquidado na leitura (AD-08). */
export class GetLotUseCase {
  constructor(
    private readonly lotsRepository: LotsRepository,
    private readonly settler: DueLotsSettler,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(id: string): Promise<{ lot: Lot; now: Date }> {
    const found = await this.lotsRepository.findById(id);
    if (!found) throw new LotNotFoundError();
    const [lot] = await this.settler.settleIfDue([found]);
    return { lot: lot ?? found, now: this.clock() };
  }
}
