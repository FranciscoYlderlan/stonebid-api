import { formatCentsAsBRL } from './wallet.ts';
import { getLotStatus, type Lot } from './lot.ts';

/** Lance gravado (RN-14: só de inserção). O pseudônimo não é gravado: deriva do licitante. */
export interface Bid {
  id: string;
  lotId: string;
  /** 1..n dentro do lote, sem buracos. */
  seq: number;
  bidderId: string;
  amountCents: number;
  idempotencyKey: string;
  /** Precisão de milissegundos: entra no hash. */
  createdAt: Date;
  prevHash: string;
  hash: string;
  seal: string;
}

/** Lance como as respostas públicas mostram: pseudônimo, sem licitante, hash nem selo (RN-15). */
export interface PublicBid {
  seq: number;
  lotId: string;
  amountCents: number;
  pseudonym: string;
  createdAt: Date;
}

/** Motivos de recusa do lance (RF-70). O código é contrato com o frontend. */
export const bidRejectionCodes = [
  'LOT_CANCELED',
  'LOT_NOT_STARTED',
  'LOT_ENDED',
  'ALREADY_WINNING',
  'BID_BELOW_MINIMUM',
  'INSUFFICIENT_FUNDS',
] as const;

export type BidRejectionCode = (typeof bidRejectionCodes)[number];

export interface BidRejection {
  code: BidRejectionCode;
  message: string;
  details?: { minAmountCents: number } | { availableCents: number };
}

export type BiddableLot = Pick<
  Lot,
  | 'startsAt'
  | 'endsAt'
  | 'canceledAt'
  | 'startingBidCents'
  | 'minIncrementCents'
  | 'currentBidCents'
  | 'leaderId'
>;

/** Menor lance aceito agora: o lance inicial sem lances (RN-03); senão atual + incremento (RN-04). */
export function minNextBidCents(
  lot: Pick<Lot, 'startingBidCents' | 'minIncrementCents' | 'currentBidCents'>,
): number {
  return lot.currentBidCents === null
    ? lot.startingBidCents
    : lot.currentBidCents + lot.minIncrementCents;
}

export interface ValidateBidInput {
  lot: BiddableLot;
  bidderId: string;
  amountCents: number;
  /** Disponível do licitante (RN-07), lido com a carteira dele travada. */
  availableCents: number;
  /** Hora do servidor, lida com o lote travado (RN-17). */
  now: Date;
}

/**
 * Regras do lance (RN-02 a RN-05, RN-07), sem efeito colateral: devolve o motivo da recusa
 * ou `null` se o lance vale. Quem chama garante que o papel é LICITANTE (RN-06) e que o lote
 * e a carteira estão travados (RN-09).
 */
export function validateBid(input: ValidateBidInput): BidRejection | null {
  const { lot, now } = input;

  switch (getLotStatus(lot, now)) {
    case 'CANCELED':
      return { code: 'LOT_CANCELED', message: 'Este lote foi cancelado e não aceita lances.' };
    case 'SCHEDULED':
      return {
        code: 'LOT_NOT_STARTED',
        message: 'Este lote ainda não começou. Os lances abrem no início do leilão.',
      };
    case 'ENDED':
      return { code: 'LOT_ENDED', message: 'Este lote já foi encerrado e não aceita lances.' };
    case 'LIVE':
      break;
  }

  if (lot.leaderId === input.bidderId) {
    return {
      code: 'ALREADY_WINNING',
      message: 'Você já lidera este lote. Espere outro licitante cobrir o seu lance.',
    };
  }

  const minAmountCents = minNextBidCents(lot);
  if (input.amountCents < minAmountCents) {
    const minimum = formatCentsAsBRL(minAmountCents);
    return {
      code: 'BID_BELOW_MINIMUM',
      message:
        lot.currentBidCents === null
          ? `O primeiro lance precisa ser de pelo menos ${minimum} (o lance inicial).`
          : `O lance precisa ser de pelo menos ${minimum} (lance atual + incremento mínimo).`,
      details: { minAmountCents },
    };
  }

  if (input.amountCents > input.availableCents) {
    return {
      code: 'INSUFFICIENT_FUNDS',
      message: `Saldo insuficiente: você tem ${formatCentsAsBRL(Math.max(input.availableCents, 0))} disponíveis para lances.`,
      details: { availableCents: input.availableCents },
    };
  }

  return null;
}
