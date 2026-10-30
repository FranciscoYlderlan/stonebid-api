import { minNextBidCents } from '../../../domain/entities/bid.ts';
import {
  getLotStatus,
  type Lot,
  type LotResult,
  type LotStatus,
} from '../../../domain/entities/lot.ts';
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
  /** Lote liquidado continua `ENDED`, com `result`. */
  status: LotStatus;
  canceledAt: string | null;
  cancelReason: string | null;
  /** Resultado da liquidação (RN-11); `null` até liquidar. */
  result: LotResult | null;
  settledAt: string | null;
  /** Link público do comprovante, só com `result = SOLD`. */
  receiptPublicId: string | null;
  /**
   * Quem olha (RF-30): só em `GET /lots/:id` com JWT válido de licitante. Nas outras respostas e
   * no stream, `null`.
   */
  viewer: { pseudonym: string } | null;
}

/**
 * O único presenter do lote: vitrine, detalhe, painel, cancelamento, resposta do lance, meus lances
 * e stream. `viewerBidderId` só vem do `GET /lots/:id` com licitante logado.
 */
export function toLotDto(lot: Lot, now: Date, viewerBidderId: string | null = null): LotDto {
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
    cancelReason: lot.cancelReason,
    result: lot.result,
    settledAt: lot.settledAt ? lot.settledAt.toISOString() : null,
    receiptPublicId: lot.result === 'SOLD' ? lot.receiptPublicId : null,
    viewer: viewerBidderId
      ? { pseudonym: pseudonymFor(env.PSEUDONYM_SECRET, lot.id, viewerBidderId) }
      : null,
  };
}
