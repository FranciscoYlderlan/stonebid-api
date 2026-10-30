import type { LotEventsPublisher } from '../../application/lot-events-publisher.ts';
import { lotEventsBus } from '../events/lot-events.ts';

/** O mesmo barramento para todo caso de uso: quem publica e a rota SSE precisam do mesmo. */
export function makeLotEventsPublisher(): LotEventsPublisher {
  return lotEventsBus;
}
