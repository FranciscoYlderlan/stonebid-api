import type { ItemAttributes } from './item.ts';

export const lotStatuses = ['SCHEDULED', 'LIVE', 'ENDED', 'CANCELED'] as const;
export type LotStatus = (typeof lotStatuses)[number];

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
  createdAt: Date;
  /** Lance atual (RN-04) e líder (RN-05, RN-07); `null` sem lances. */
  currentBidCents: number | null;
  leaderId: string | null;
  /** Cabeça da cadeia de hash (M-12): número, hash e selo do último lance; 0 e `null` sem lances. */
  headSeq: number;
  headHash: string | null;
  headSeal: string | null;
}

/** Duração mínima do lote (Q-07). */
export const MIN_LOT_DURATION_MS = 5 * 60 * 1000;
/** Tolerância para "início no passado": relógio do cliente e latência (Q-07). */
export const START_TOLERANCE_MS = 60 * 1000;

/**
 * Estado do lote derivado do relógio do servidor (RN-01, contrato 5.1).
 * Só o cancelamento é gravado.
 */
export function getLotStatus(
  lot: Pick<Lot, 'startsAt' | 'endsAt' | 'canceledAt'>,
  now: Date,
): LotStatus {
  if (lot.canceledAt) return 'CANCELED';
  const t = now.getTime();
  if (t < lot.startsAt.getTime()) return 'SCHEDULED';
  if (t < lot.endsAt.getTime()) return 'LIVE';
  return 'ENDED';
}

/**
 * Decide o cancelamento (RF-22, RN-12, M-13), para lote agendado e ao vivo: devolve o motivo
 * da recusa ou `null` se pode cancelar. Quem chama lê o lote e a hora com a linha do lote
 * travada, na mesma serialização do lance (RN-09). Sem o OPC-2, lote com lances não cancela.
 */
export function getCancelRefusal(
  lot: Pick<Lot, 'startsAt' | 'endsAt' | 'canceledAt' | 'headSeq'>,
  now: Date,
): string | null {
  const status = getLotStatus(lot, now);
  if (status === 'CANCELED') return 'O lote já está cancelado.';
  if (status === 'ENDED') return 'O lote já foi encerrado e não pode ser cancelado.';
  if (lot.headSeq > 0) return 'O lote já tem lances e não pode ser cancelado.';
  return null;
}
