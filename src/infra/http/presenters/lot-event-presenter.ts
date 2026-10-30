import type { Lot } from '../../../domain/entities/lot.ts';
import { toLotDto } from './lot-presenter.ts';

/**
 * `data` de todo evento do SSE (snapshot, bid, canceled, settled): `{ serverTime, lot }`, com o
 * mesmo `LotDto` do `GET /lots/:id` e sem dado de quem assiste (`viewer: null`, RN-15): a rota é
 * pública e o `EventSource` não manda autenticação.
 */
export function toLotEventData(lot: Lot, now: Date): string {
  return JSON.stringify({ serverTime: now.toISOString(), lot: toLotDto(lot, now) });
}
