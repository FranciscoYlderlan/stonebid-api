import type { LotBidsReader } from '../../domain/repositories/lot-bids-reader.ts';

/** Lances ainda não existem (chegam no I2): nenhum lote tem lance. Troque pela leitura real no I2. */
export class NoBidsYetReader implements LotBidsReader {
  async hasBids(_lotId: string): Promise<boolean> {
    return false;
  }
}
