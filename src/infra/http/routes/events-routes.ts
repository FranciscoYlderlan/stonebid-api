import type { ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import type { InMemoryLotEventsBus } from '../../events/in-memory-lot-events-bus.ts';
import { lotEventsController } from '../controllers/events/lot-events-controller.ts';

export interface EventsRoutesOptions {
  bus: InMemoryLotEventsBus;
}

/** Tempo real por SSE (AD-04). Público: o `EventSource` não manda cabeçalho de autenticação. */
export async function eventsRoutes(
  app: FastifyInstance,
  options: EventsRoutesOptions,
): Promise<void> {
  const streams = new Set<ServerResponse>();

  app.get('/lots/:id/events', lotEventsController(options.bus, streams));

  // Streams abertos não terminam sozinhos: fecha todos antes do servidor, ou o `close` espera.
  app.addHook('preClose', async () => {
    for (const stream of streams) stream.end();
  });
}
