import type { ItemAuction } from '../entities/item-auction.ts';
import { AppError } from './app-error.ts';

const messages: Record<ItemAuction['status'], string> = {
  SCHEDULED:
    'Esta obra já tem um lote agendado. Uma obra só pode estar em um lote por vez: ' +
    'para leiloá-la em outro lote, o lote atual precisa ser cancelado.',
  LIVE: 'Esta obra já está em leilão em um lote ao vivo. Uma obra só pode estar em um lote por vez.',
  SOLD: 'Esta obra já foi vendida em leilão e não pode ser leiloada de novo.',
};

/** RN-19: a obra já tem lote agendado, ao vivo ou arrematado. */
export class ItemAlreadyAuctionedError extends AppError {
  readonly code = 'ITEM_ALREADY_AUCTIONED';
  readonly details: ItemAuction;

  constructor(auction: ItemAuction) {
    super(messages[auction.status]);
    this.details = { status: auction.status, lotId: auction.lotId };
  }
}
