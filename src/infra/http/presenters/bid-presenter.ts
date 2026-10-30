import type { PublicBid } from '../../../domain/entities/bid.ts';

/** Lance na resposta do POST: pseudônimo, sem licitante, hash nem selo (RN-15). */
export interface BidDto {
  seq: number;
  lotId: string;
  amountCents: number;
  pseudonym: string;
  createdAt: string;
}

/** Linha do histórico público (GET /lots/:id/bids). */
export type BidHistoryItemDto = Omit<BidDto, 'lotId'>;

export function toBidDto(bid: PublicBid): BidDto {
  return {
    seq: bid.seq,
    lotId: bid.lotId,
    amountCents: bid.amountCents,
    pseudonym: bid.pseudonym,
    createdAt: bid.createdAt.toISOString(),
  };
}

export function toBidHistoryItemDto(bid: PublicBid): BidHistoryItemDto {
  return {
    seq: bid.seq,
    amountCents: bid.amountCents,
    pseudonym: bid.pseudonym,
    createdAt: bid.createdAt.toISOString(),
  };
}
