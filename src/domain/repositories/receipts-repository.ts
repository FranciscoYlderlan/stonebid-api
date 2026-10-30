import type { ReceiptWithLot } from '../entities/receipt.ts';

export interface ReceiptsRepository {
  /** Comprovante pelo identificador público, com o título e a cabeça do lote; `null` se não existe. */
  findByPublicId(publicId: string): Promise<ReceiptWithLot | null>;
}
