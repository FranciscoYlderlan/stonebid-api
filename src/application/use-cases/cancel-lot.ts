import { getLotStatus, type Lot } from '../../domain/entities/lot.ts';
import { ForbiddenError } from '../../domain/errors/forbidden-error.ts';
import { LotNotCancelableError } from '../../domain/errors/lot-not-cancelable-error.ts';
import { LotNotFoundError } from '../../domain/errors/lot-not-found-error.ts';
import type { LotBidsReader } from '../../domain/repositories/lot-bids-reader.ts';
import type { LotsRepository } from '../../domain/repositories/lots-repository.ts';

export interface CancelLotInput {
  lotId: string;
  auctioneerId: string;
}

/**
 * Cancelamento (RF-22, RN-12): só o leiloeiro dono, antes do encerramento e sem lances.
 * A checagem de lances passa pela porta LotBidsReader, que o I2 liga aos lances reais.
 */
export class CancelLotUseCase {
  constructor(
    private readonly lotsRepository: LotsRepository,
    private readonly bidsReader: LotBidsReader,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(input: CancelLotInput): Promise<{ lot: Lot; now: Date }> {
    const lot = await this.lotsRepository.findById(input.lotId);
    if (!lot) throw new LotNotFoundError();
    if (lot.auctioneerId !== input.auctioneerId) {
      throw new ForbiddenError('Só o leiloeiro que criou o lote pode cancelá-lo.');
    }

    const now = this.clock();
    assertCancelable(getLotStatus(lot, now));

    if (await this.bidsReader.hasBids(lot.id)) {
      throw new LotNotCancelableError('O lote já tem lances e não pode ser cancelado.');
    }

    const canceled = await this.lotsRepository.cancel(lot.id, now);
    if (!canceled) {
      // Outro pedido cancelou ou o lote encerrou entre a leitura e a gravação.
      const current = await this.lotsRepository.findById(lot.id);
      assertCancelable(current ? getLotStatus(current, this.clock()) : 'CANCELED');
      throw new LotNotCancelableError('O lote não pode mais ser cancelado.');
    }

    return { lot: canceled, now };
  }
}

function assertCancelable(status: ReturnType<typeof getLotStatus>): void {
  if (status === 'CANCELED') throw new LotNotCancelableError('O lote já está cancelado.');
  if (status === 'ENDED') {
    throw new LotNotCancelableError('O lote já foi encerrado e não pode ser cancelado.');
  }
}
