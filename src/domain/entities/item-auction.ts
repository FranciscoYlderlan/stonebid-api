import { getLotStatus, type Lot } from './lot.ts';

/**
 * Situação de uma obra no Stonebid (RN-19): em leilão (agendado ou ao vivo) ou vendida
 * (lote encerrado com lances, isto é, arrematado). Usa os mesmos nomes de LotStatus.
 */
export const itemAuctionStatuses = ['SCHEDULED', 'LIVE', 'SOLD'] as const;
export type ItemAuctionStatus = (typeof itemAuctionStatuses)[number];

export interface ItemAuction {
  status: ItemAuctionStatus;
  /** Lote que prende a obra. */
  lotId: string;
}

/** Ordem de precedência quando há mais de um lote preso (dado antigo): vendido vale sobre os outros. */
const precedence: Record<ItemAuctionStatus, number> = { SOLD: 0, LIVE: 1, SCHEDULED: 2 };

/**
 * RN-19: uma obra só pode ter um lote "vivo" por vez, e nunca de novo depois de vendida.
 * Prende a obra: lote agendado, ao vivo ou encerrado com lances (arrematado).
 * Libera: lote cancelado ou encerrado sem lances.
 *
 * Função pura: recebe os lotes da obra, o relógio do servidor e os ids dos lotes que têm
 * lances. Devolve `null` se a obra está livre para um lote novo.
 */
export function getItemAuction(
  lots: ReadonlyArray<Pick<Lot, 'id' | 'startsAt' | 'endsAt' | 'canceledAt'>>,
  now: Date,
  lotIdsWithBids: ReadonlySet<string>,
): ItemAuction | null {
  let found: ItemAuction | null = null;

  for (const lot of lots) {
    const status = blockingStatus(getLotStatus(lot, now), lotIdsWithBids.has(lot.id));
    if (!status) continue;
    if (!found || precedence[status] < precedence[found.status]) {
      found = { status, lotId: lot.id };
    }
  }

  return found;
}

function blockingStatus(
  status: ReturnType<typeof getLotStatus>,
  hasBids: boolean,
): ItemAuctionStatus | null {
  switch (status) {
    case 'SCHEDULED':
    case 'LIVE':
      return status;
    case 'ENDED':
      return hasBids ? 'SOLD' : null;
    case 'CANCELED':
      return null;
  }
}

/**
 * Lotes encerrados entre os dados: só neles a presença de lance muda a resposta
 * (agendado e ao vivo prendem com ou sem lance; cancelado nunca prende).
 */
export function endedLotIds(
  lots: ReadonlyArray<Pick<Lot, 'id' | 'startsAt' | 'endsAt' | 'canceledAt'>>,
  now: Date,
): string[] {
  return lots.filter((lot) => getLotStatus(lot, now) === 'ENDED').map((lot) => lot.id);
}
