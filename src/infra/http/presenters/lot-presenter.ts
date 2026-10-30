import { minNextBidCents } from '../../../domain/entities/bid.ts';
import { getLotStatus, type Lot, type LotStatus } from '../../../domain/entities/lot.ts';
import type { ItemAttributes } from '../../../domain/entities/item.ts';
import { pseudonymFor } from '../../../domain/integrity/bid-chain.ts';
import { env } from '../../../env/index.ts';

/** Lote como a API devolve: sem dado pessoal do leiloeiro nem do líder (RN-15). */
export interface LotDto {
  id: string;
  title: string;
  attributes: ItemAttributes;
  imageUrl: string;
  startingBidCents: number;
  minIncrementCents: number;
  /** Lance atual; `null` sem lances. */
  currentBidCents: number | null;
  /** Menor lance aceito agora: o inicial sem lances; senão atual + incremento (RN-03, RN-04). */
  minNextBidCents: number;
  /** Pseudônimo do líder no lote (AD-09); `null` sem lances. */
  leaderPseudonym: string | null;
  startsAt: string;
  originalEndsAt: string;
  endsAt: string;
  status: LotStatus;
  canceledAt: string | null;
}

/** O único presenter do lote: vitrine, detalhe, painel, cancelamento e resposta do lance. */
export function toLotDto(lot: Lot, now: Date): LotDto {
  return {
    id: lot.id,
    title: lot.title,
    attributes: lot.attributes,
    imageUrl: `/lots/${lot.id}/image`,
    startingBidCents: lot.startingBidCents,
    minIncrementCents: lot.minIncrementCents,
    currentBidCents: lot.currentBidCents,
    minNextBidCents: minNextBidCents(lot),
    leaderPseudonym: lot.leaderId ? pseudonymFor(env.PSEUDONYM_SECRET, lot.id, lot.leaderId) : null,
    startsAt: lot.startsAt.toISOString(),
    originalEndsAt: lot.originalEndsAt.toISOString(),
    endsAt: lot.endsAt.toISOString(),
    status: getLotStatus(lot, now),
    canceledAt: lot.canceledAt ? lot.canceledAt.toISOString() : null,
  };
}
