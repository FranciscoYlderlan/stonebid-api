import type { ItemAttributes } from './item.ts';

export const lotStatuses = ['SCHEDULED', 'LIVE', 'ENDED', 'CANCELED'] as const;
export type LotStatus = (typeof lotStatuses)[number];

/** Resultado da liquidação (RN-11): arrematado ou sem vencedor. */
export const lotResults = ['SOLD', 'NO_WINNER'] as const;
export type LotResult = (typeof lotResults)[number];

/** Lote sem os bytes da imagem (servidos à parte por GET /lots/:id/image). */
export interface Lot {
  id: string;
  auctioneerId: string;
  externalId: string;
  title: string;
  attributes: ItemAttributes;
  imageContentType: string;
  /** Lance inicial = valor mínimo (Q-06), em centavos (RN-16). */
  startingBidCents: number;
  minIncrementCents: number;
  startsAt: Date;
  originalEndsAt: Date;
  /** Fim atual (o anti-sniping da RN-10 pode prorrogar). */
  endsAt: Date;
  canceledAt: Date | null;
  /** Motivo do cancelamento; `null` se não foi cancelado. */
  cancelReason: string | null;
  createdAt: Date;
  /** Lance atual (RN-04) e líder (RN-05, RN-07); `null` sem lances. */
  currentBidCents: number | null;
  leaderId: string | null;
  /** Cabeça da cadeia de hash (M-12): número, hash e selo do último lance; 0 e `null` sem lances. */
  headSeq: number;
  headHash: string | null;
  headSeal: string | null;
  /** Liquidação (RN-11, AD-08): hora e resultado; `null` até liquidar. */
  settledAt: Date | null;
  result: LotResult | null;
  /** Link público do comprovante (só lote arrematado). */
  receiptPublicId: string | null;
}

/** Duração mínima do lote (Q-07). */
export const MIN_LOT_DURATION_MS = 5 * 60 * 1000;
/** Tolerância para "início no passado": relógio do cliente e latência (Q-07). */
export const START_TOLERANCE_MS = 60 * 1000;

/** Anti-sniping (RN-10): janela final e prorrogação, ambas de 2 minutos. */
export const ANTI_SNIPING_WINDOW_MS = 2 * 60 * 1000;

/**
 * Fim do lote depois de um lance aceito em `now` (RN-10, Q-03 opção A): com 120 000 ms ou menos até
 * o fim, `max(endsAt, now + 2 min)`; senão o fim não muda. O fim nunca diminui e não há limite de
 * prorrogações. Quem chama já validou o lance (lote ao vivo, `now < endsAt`) com o lote travado.
 */
export function extendEndsAt(endsAt: Date, now: Date): Date {
  const remaining = endsAt.getTime() - now.getTime();
  if (remaining > ANTI_SNIPING_WINDOW_MS) return endsAt;
  return new Date(Math.max(endsAt.getTime(), now.getTime() + ANTI_SNIPING_WINDOW_MS));
}

/** Lote vencido e ainda não liquidado nem cancelado: a liquidação (AD-08) deve rodar. */
export function isDueForSettlement(
  lot: Pick<Lot, 'endsAt' | 'canceledAt' | 'settledAt'>,
  now: Date,
): boolean {
  return !lot.canceledAt && !lot.settledAt && now.getTime() >= lot.endsAt.getTime();
}

/**
 * Estado do lote derivado do relógio do servidor (RN-01, contrato 5.1).
 * Só o cancelamento é gravado.
 */
export function getLotStatus(
  lot: Pick<Lot, 'startsAt' | 'endsAt' | 'canceledAt'> & { settledAt?: Date | null },
  now: Date,
): LotStatus {
  if (lot.canceledAt) return 'CANCELED';
  // Liquidado é sempre encerrado, qualquer que seja o relógio de quem pergunta.
  if (lot.settledAt) return 'ENDED';
  const t = now.getTime();
  if (t < lot.startsAt.getTime()) return 'SCHEDULED';
  if (t < lot.endsAt.getTime()) return 'LIVE';
  return 'ENDED';
}

export interface CancelRefusal {
  /** `LOT_ENDED` para lote encerrado ou liquidado; `LOT_NOT_CANCELABLE` para o resto. */
  code: 'LOT_ENDED' | 'LOT_NOT_CANCELABLE';
  message: string;
}

/** Motivo do cancelamento: 3 a 280 caracteres, sem espaços nas pontas. */
export const CANCEL_REASON_MIN = 3;
export const CANCEL_REASON_MAX = 280;

/**
 * Decide o cancelamento (RF-22, RN-12, M-13), para lote agendado e ao vivo: devolve o motivo
 * da recusa ou `null` se pode cancelar. Quem chama lê o lote e a hora com a linha do lote
 * travada, na mesma serialização do lance (RN-09). Sem o OPC-2, lote com lances não cancela.
 */
export function getCancelRefusal(
  lot: Pick<Lot, 'startsAt' | 'endsAt' | 'canceledAt' | 'headSeq'> & { settledAt?: Date | null },
  now: Date,
): CancelRefusal | null {
  const status = getLotStatus(lot, now);
  if (status === 'CANCELED') {
    return { code: 'LOT_NOT_CANCELABLE', message: 'O lote já está cancelado.' };
  }
  if (status === 'ENDED') {
    return { code: 'LOT_ENDED', message: 'O lote já foi encerrado e não pode ser cancelado.' };
  }
  if (lot.headSeq > 0) {
    return {
      code: 'LOT_NOT_CANCELABLE',
      message: 'O lote já tem lances e não pode ser cancelado.',
    };
  }
  return null;
}
