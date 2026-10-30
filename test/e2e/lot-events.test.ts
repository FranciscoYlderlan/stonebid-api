import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { lotEventsBus } from '../../src/infra/events/lot-events.ts';
import { prisma } from '../../src/infra/repositories/prisma/prisma-client.ts';
import { testEnv } from '../test-env.ts';
import { registerUser } from './helpers.ts';
import { MOCK_IMAGE } from './items-api-mock.ts';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

interface SseEvent {
  event: string;
  data: { serverTime: string; lot: Record<string, unknown> };
}

/** Stream SSE aberto por HTTP de verdade (o `inject` não serve para resposta que não termina). */
interface OpenStream {
  status: number;
  headers: http.IncomingHttpHeaders;
  next(timeoutMs?: number): Promise<SseEvent>;
  close(): void;
  closed: Promise<void>;
}

function openStream(baseUrl: string, path: string): Promise<OpenStream> {
  return new Promise((resolve, reject) => {
    const request = http.get(
      `${baseUrl}${path}`,
      { headers: { origin: testEnv.CORS_ORIGIN, accept: 'text/event-stream' } },
      (response) => {
        const queue: SseEvent[] = [];
        const waiters: ((event: SseEvent) => void)[] = [];
        let buffer = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          buffer += chunk;
          let end: number;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const fields = Object.fromEntries(
              block
                .split('\n')
                .filter((line) => line && !line.startsWith(':'))
                .map((line) => [
                  line.slice(0, line.indexOf(':')),
                  line.slice(line.indexOf(':') + 2),
                ]),
            );
            if (!fields.event) continue;
            const event = { event: fields.event, data: JSON.parse(fields.data ?? 'null') };
            const waiter = waiters.shift();
            if (waiter) waiter(event);
            else queue.push(event);
          }
        });
        const closed = new Promise<void>((done) => response.once('close', () => done()));
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          next(timeoutMs = 2000) {
            const ready = queue.shift();
            if (ready) return Promise.resolve(ready);
            return new Promise((done, fail) => {
              const timer = setTimeout(
                () => fail(new Error(`nenhum evento em ${timeoutMs} ms`)),
                timeoutMs,
              );
              waiters.push((event) => {
                clearTimeout(timer);
                done(event);
              });
            });
          },
          close() {
            request.destroy();
          },
          closed,
        });
      },
    );
    request.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error);
    });
  });
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('condição não atingida');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Tempo real por SSE (AD-04, RF-31, RNF-06). */
describe('GET /lots/:id/events (SSE)', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let auctioneer: { token: string; id: string };
  let ana: { token: string; id: string };

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  async function user(role: 'AUCTIONEER' | 'BIDDER', depositCents = 0) {
    const { response } = await registerUser(app, { role });
    const { token, user: created } = response.json();
    if (depositCents > 0) {
      await app.inject({
        method: 'POST',
        url: '/wallet/deposits',
        headers: { ...auth(token), 'idempotency-key': randomUUID() },
        payload: { amountCents: depositCents },
      });
    }
    return { token: token as string, id: created.id as string };
  }

  async function createLot(startsAt = new Date(Date.now() - MINUTE)) {
    const lot = await prisma.lot.create({
      data: {
        auctioneerId: auctioneer.id,
        externalId: `sse-${randomUUID()}`,
        title: 'Lote SSE',
        attributes: {},
        imageData: new Uint8Array(MOCK_IMAGE),
        imageContentType: 'image/png',
        startingBidCents: 10_000,
        minIncrementCents: 500,
        startsAt,
        originalEndsAt: new Date(Date.now() + HOUR),
        endsAt: new Date(Date.now() + HOUR),
      },
    });
    return lot.id;
  }

  beforeAll(async () => {
    app = await buildApp({ mcpEnabled: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    auctioneer = await user('AUCTIONEER');
    ana = await user('BIDDER', 100_000);
  });

  afterAll(async () => {
    await app.close();
  });

  it('manda o snapshot ao conectar e o lance de outra requisição em menos de 2 s', async () => {
    const lotId = await createLot();
    const stream = await openStream(baseUrl, `/lots/${lotId}/events`);

    expect(stream.status).toBe(200);
    expect(stream.headers['content-type']).toBe('text/event-stream');
    expect(stream.headers['cache-control']).toBe('no-cache, no-transform');
    expect(stream.headers['x-accel-buffering']).toBe('no');
    expect(stream.headers['access-control-allow-origin']).toBe(testEnv.CORS_ORIGIN);

    const snapshot = await stream.next();
    expect(snapshot.event).toBe('snapshot');
    expect(snapshot.data.lot).toMatchObject({ id: lotId, currentBidCents: null, status: 'LIVE' });
    expect(Number.isNaN(Date.parse(snapshot.data.serverTime))).toBe(false);
    expect(snapshot.data.lot).not.toHaveProperty('leaderId');

    const start = Date.now();
    const bid = await app.inject({
      method: 'POST',
      url: `/lots/${lotId}/bids`,
      headers: { ...auth(ana.token), 'idempotency-key': randomUUID() },
      payload: { amountCents: 12_000 },
    });
    expect(bid.statusCode).toBe(201);

    const event = await stream.next(2000);
    expect(Date.now() - start).toBeLessThan(2000);
    expect(event.event).toBe('bid');
    expect(event.data.lot).toMatchObject({ id: lotId, currentBidCents: 12_000 });
    expect(event.data.lot.leaderPseudonym).toEqual(expect.stringMatching(/^Licitante /));

    // Replay da mesma chave não gera evento novo; um lance novo gera.
    const key = randomUUID();
    const bruno = await user('BIDDER', 100_000);
    for (let i = 0; i < 2; i++) {
      await app.inject({
        method: 'POST',
        url: `/lots/${lotId}/bids`,
        headers: { ...auth(bruno.token), 'idempotency-key': key },
        payload: { amountCents: 13_000 },
      });
    }
    const second = await stream.next();
    expect(second.data.lot.currentBidCents).toBe(13_000);
    await expect(stream.next(300)).rejects.toThrow();

    stream.close();
  });

  it('o cancelamento gera o evento canceled', async () => {
    const lotId = await createLot(new Date(Date.now() + MINUTE));
    const stream = await openStream(baseUrl, `/lots/${lotId}/events`);
    expect((await stream.next()).data.lot.status).toBe('SCHEDULED');

    const cancel = await app.inject({
      method: 'POST',
      url: `/lots/${lotId}/cancel`,
      headers: auth(auctioneer.token),
      payload: { reason: 'Obra retirada pelo comitente.' },
    });
    expect(cancel.statusCode).toBe(200);

    const event = await stream.next();
    expect(event.event).toBe('canceled');
    expect(event.data.lot).toMatchObject({ id: lotId, status: 'CANCELED' });
    stream.close();
  });

  it('a liquidação (na leitura) gera o evento settled uma vez, com result e comprovante', async () => {
    const lotId = await createLot();
    const placed = await app.inject({
      method: 'POST',
      url: `/lots/${lotId}/bids`,
      headers: { ...auth(ana.token), 'idempotency-key': randomUUID() },
      payload: { amountCents: 10_000 },
    });
    expect(placed.statusCode).toBe(201);
    const stream = await openStream(baseUrl, `/lots/${lotId}/events`);
    expect((await stream.next()).event).toBe('snapshot');

    // O lote vence; a leitura liquida (AD-08) e só essa liquidação publica.
    await prisma.lot.update({
      where: { id: lotId },
      data: { endsAt: new Date(Date.now() - 1_000) },
    });
    await app.inject({ method: 'GET', url: `/lots/${lotId}` });
    await app.inject({ method: 'GET', url: `/lots/${lotId}` });

    const event = await stream.next();
    expect(event.event).toBe('settled');
    expect(event.data.lot).toMatchObject({
      id: lotId,
      status: 'ENDED',
      result: 'SOLD',
      receiptPublicId: expect.any(String),
      viewer: null,
    });
    await expect(stream.next(300)).rejects.toThrow();
    stream.close();
  });

  it('remove o listener quando a conexão fecha', async () => {
    const lotId = await createLot();
    const first = await openStream(baseUrl, `/lots/${lotId}/events`);
    const second = await openStream(baseUrl, `/lots/${lotId}/events`);
    await first.next();
    await second.next();
    expect(lotEventsBus.listenerCount(lotId)).toBe(2);

    first.close();
    await waitFor(() => lotEventsBus.listenerCount(lotId) === 1);
    second.close();
    await waitFor(() => lotEventsBus.listenerCount(lotId) === 0);
  });

  it('lote inexistente: 404 LOT_NOT_FOUND em JSON, sem listener', async () => {
    const lotId = randomUUID();
    const response = await app.inject({ method: 'GET', url: `/lots/${lotId}/events` });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json().error.code).toBe('LOT_NOT_FOUND');
    expect(lotEventsBus.listenerCount(lotId)).toBe(0);
  });

  it('id que não é UUID: 404, como o GET /lots/:id', async () => {
    const response = await app.inject({ method: 'GET', url: '/lots/nao-e-uuid/events' });
    expect(response.statusCode).toBe(404);
  });

  it('o close da aplicação encerra os streams abertos', async () => {
    const other = await buildApp({ mcpEnabled: false });
    await other.listen({ port: 0, host: '127.0.0.1' });
    const url = `http://127.0.0.1:${(other.server.address() as AddressInfo).port}`;
    const lotId = await createLot();
    const stream = await openStream(url, `/lots/${lotId}/events`);
    await stream.next();
    await other.close();
    await stream.closed;
    await waitFor(() => lotEventsBus.listenerCount(lotId) === 0);
  });
});
