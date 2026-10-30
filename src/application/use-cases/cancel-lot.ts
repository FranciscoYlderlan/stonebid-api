import { getCancelRefusal, type Lot } from '../../domain/entities/lot.ts';
import { ForbiddenError } from '../../domain/errors/forbidden-error.ts';
import { LotEndedError } from '../../domain/errors/lot-ended-error.ts';
import { LotNotCancelableError } from '../../domain/errors/lot-not-cancelable-error.ts';
import { LotNotFoundError } from '../../domain/errors/lot-not-found-error.ts';
import type { LotsRepository } from '../../domain/repositories/lots-repository.ts';
import { type LotEventsPublisher, noLotEvents } from '../lot-events-publisher.ts';

export interface CancelLotInput {
  lotId: string;
  auctioneerId: string;
  /** Motivo (3 a 280 caracteres, já validado na borda), gravado no lote e mostrado na sala. */
  reason: string;
}

/**
 * Cancelamento (RF-22, RN-12, M-13): só o leiloeiro dono, antes do encerramento e sem lances,
 * sempre com motivo. Lote encerrado ou liquidado → `LOT_ENDED`.
 * Lances, cancelamento anterior e fim são lidos com o lote travado, na mesma trava do lance:
 * cancelamento e lance ao mesmo tempo, só um passa.
 */
export class CancelLotUseCase {
  constructor(
    private readonly lotsRepository: LotsRepository,
    private readonly clock: () => Date = () => new Date(),
    private readonly lotEvents: LotEventsPublisher = noLotEvents,
  ) {}

  async execute(input: CancelLotInput): Promise<{ lot: Lot; now: Date }> {
    const lot = await this.lotsRepository.findById(input.lotId);
    if (!lot) throw new LotNotFoundError();
    // O dono do lote nunca muda: a checagem não precisa da trava.
    if (lot.auctioneerId !== input.auctioneerId) {
      throw new ForbiddenError('Só o leiloeiro que criou o lote pode cancelá-lo.');
    }

    let now = this.clock();
    const canceled = await this.lotsRepository.cancel(lot.id, input.reason, (locked) => {
      now = this.clock();
      const refusal = getCancelRefusal(locked, now);
      if (refusal?.code === 'LOT_ENDED') throw new LotEndedError(refusal.message);
      if (refusal) throw new LotNotCancelableError(refusal.message);
      return now;
    });
    if (!canceled) throw new LotNotFoundError();
    this.lotEvents.publish(canceled.id, 'canceled'); // depois do COMMIT (AD-04)

    return { lot: canceled, now };
  }
}
