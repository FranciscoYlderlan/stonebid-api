import { getLotStatus, type Lot, type LotStatus } from '../../../domain/entities/lot.ts';
import type { ItemAttributes } from '../../../domain/entities/item.ts';

/** Lote como a API devolve: sem dado pessoal do leiloeiro (RN-15). */
export interface LotDto {
  id: string;
  title: string;
  attributes: ItemAttributes;
  imageUrl: string;
  startingBidCents: number;
  minIncrementCents: number;
  /** Lance atual: os lances chegam no I2. */
  currentBidCents: number | null;
  startsAt: string;
  originalEndsAt: string;
  endsAt: string;
  status: LotStatus;
  canceledAt: string | null;
}

export function toLotDto(lot: Lot, now: Date): LotDto {
  return {
    id: lot.id,
    title: lot.title,
    attributes: lot.attributes,
    imageUrl: `/lots/${lot.id}/image`,
    startingBidCents: lot.startingBidCents,
    minIncrementCents: lot.minIncrementCents,
    currentBidCents: null,
    startsAt: lot.startsAt.toISOString(),
    originalEndsAt: lot.originalEndsAt.toISOString(),
    endsAt: lot.endsAt.toISOString(),
    status: getLotStatus(lot, now),
    canceledAt: lot.canceledAt ? lot.canceledAt.toISOString() : null,
  };
}
