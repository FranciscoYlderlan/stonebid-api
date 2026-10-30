import type { ServerResponse } from 'node:http';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { LotNotFoundError } from '../../../../domain/errors/lot-not-found-error.ts';
import type {
  InMemoryLotEventsBus,
  LotEventMessage,
} from '../../../events/in-memory-lot-events-bus.ts';
import { lotIdParamsSchema } from '../../schemas/lot-schemas.ts';

/** Comentário `: ping` a cada 15 s: mantém a conexão viva em proxies que cortam stream parado. */
export const LOT_EVENTS_PING_MS = 15_000;

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  'X-Accel-Buffering': 'no',
  Connection: 'keep-alive',
} as const;

type SseMessage = LotEventMessage | { type: 'snapshot'; data: string };

/**
 * `GET /lots/:id/events` (AD-04, RF-31): stream SSE público do lote. Ao conectar, `snapshot`;
 * depois `bid`, `canceled` e `settled`, cada um com `{ serverTime, lot }`. Lote inexistente: 404
 * em JSON, antes de abrir o stream. Ao fechar a conexão, o listener e o ping saem.
 */
export function lotEventsController(bus: InMemoryLotEventsBus, streams: Set<ServerResponse>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = lotIdParamsSchema.parse(request.params);
    const raw = reply.raw;
    const send = (message: SseMessage) => {
      raw.write(`event: ${message.type}\ndata: ${message.data}\n\n`);
    };

    // Inscreve antes de ler o snapshot (nenhum lance entre os dois se perde); o que chegar antes
    // do snapshot sai logo depois dele, na ordem.
    let pending: LotEventMessage[] | null = [];
    const unsubscribe = bus.subscribe(id, (message) => {
      if (pending) pending.push(message);
      else send(message);
    });

    let snapshot: string | null;
    try {
      snapshot = await bus.snapshot(id);
    } catch (error) {
      unsubscribe();
      throw error;
    }
    if (snapshot === null || request.raw.destroyed) {
      unsubscribe();
      if (snapshot === null) throw new LotNotFoundError();
      return reply.hijack();
    }

    // Daqui em diante a resposta é escrita à mão; os cabeçalhos do CORS (hook do @fastify/cors)
    // já estão no reply e vão juntos.
    reply.hijack();
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) raw.setHeader(name, value);
    }
    raw.writeHead(200, SSE_HEADERS);
    send({ type: 'snapshot', data: snapshot });
    for (const message of pending) send(message);
    pending = null;

    const ping = setInterval(() => raw.write(': ping\n\n'), LOT_EVENTS_PING_MS);
    streams.add(raw);
    raw.once('close', () => {
      clearInterval(ping);
      unsubscribe();
      streams.delete(raw);
    });
  };
}
