import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { prisma } from '../../src/infra/repositories/prisma/prisma-client.ts';
import { registerUser } from './helpers.ts';
import { MOCK_IMAGE } from './items-api-mock.ts';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** Rotas de lance (RF-33, RF-70) e histórico público (RN-15). */
describe('lances pela API (RF-33, RF-70, T-08, T-09)', () => {
  let app: FastifyInstance;
  let auctioneer: { token: string; id: string };
  let ana: { token: string; id: string; email: string; name: string };
  let bruno: { token: string; id: string; email: string; name: string };

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  async function bidder(name: string, depositCents: number) {
    const { payload, response } = await registerUser(app, { name, role: 'BIDDER' });
    const { token, user } = response.json();
    await app.inject({
      method: 'POST',
      url: '/wallet/deposits',
      headers: { ...auth(token), 'idempotency-key': randomUUID() },
      payload: { amountCents: depositCents },
    });
    return { token, id: user.id as string, email: payload.email, name };
  }

  async function createLot(
    overrides: Partial<{ startsAt: Date; endsAt: Date; canceledAt: Date }> = {},
  ) {
    const lot = await prisma.lot.create({
      data: {
        auctioneerId: auctioneer.id,
        externalId: `lance-http-${randomUUID()}`,
        title: 'Lote HTTP',
        attributes: {},
        imageData: new Uint8Array(MOCK_IMAGE),
        imageContentType: 'image/png',
        startingBidCents: 10_000,
        minIncrementCents: 500,
        startsAt: overrides.startsAt ?? new Date(Date.now() - MINUTE),
        originalEndsAt: overrides.endsAt ?? new Date(Date.now() + HOUR),
        endsAt: overrides.endsAt ?? new Date(Date.now() + HOUR),
        canceledAt: overrides.canceledAt ?? null,
      },
    });
    return lot.id;
  }

  function placeBid(
    lotId: string,
    token: string | null,
    amountCents: unknown,
    key: string | null = randomUUID(),
  ) {
    return app.inject({
      method: 'POST',
      url: `/lots/${lotId}/bids`,
      headers: {
        ...(token ? auth(token) : {}),
        ...(key ? { 'idempotency-key': key } : {}),
      },
      payload: { amountCents },
    });
  }

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const a = (await registerUser(app, { role: 'AUCTIONEER' })).response.json();
    auctioneer = { token: a.token, id: a.user.id };
    ana = await bidder('Ana Pessoa Real', 100_000);
    bruno = await bidder('Bruno Pessoa Real', 100_000);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('201: lance aceito devolve { bid, lot, wallet } no contrato', async () => {
    const lotId = await createLot();
    const response = await placeBid(lotId, ana.token, 10_000);

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.bid).toEqual({
      seq: 1,
      lotId,
      amountCents: 10_000,
      pseudonym: expect.stringMatching(/^Licitante [0-9A-F]{4}$/),
      createdAt: expect.any(String),
    });
    expect(body.lot).toMatchObject({
      id: lotId,
      status: 'LIVE',
      currentBidCents: 10_000,
      minNextBidCents: 10_500,
      leaderPseudonym: body.bid.pseudonym,
    });
    expect(body.wallet).toEqual({
      totalCents: 100_000,
      committedCents: 10_000,
      availableCents: 90_000,
      depositLimitCents: expect.any(Number),
    });
  });

  it('LotDto sem lances: currentBidCents e leaderPseudonym null, minNextBidCents = lance inicial', async () => {
    const lotId = await createLot();
    const response = await app.inject({ method: 'GET', url: `/lots/${lotId}` });
    expect(response.json().lot).toMatchObject({
      currentBidCents: null,
      minNextBidCents: 10_000,
      leaderPseudonym: null,
    });
  });

  it('200: mesma chave e mesmo valor devolve o mesmo lance; outro valor → 409', async () => {
    const lotId = await createLot();
    const key = randomUUID();
    const first = await placeBid(lotId, ana.token, 10_000, key);
    const again = await placeBid(lotId, ana.token, 10_000, key);
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(200);
    expect(again.json().bid).toEqual(first.json().bid);

    const reused = await placeBid(lotId, ana.token, 12_000, key);
    expect(reused.statusCode).toBe(409);
    expect(reused.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await prisma.bid.count({ where: { lotId } })).toBe(1);
  });

  describe('cada motivo do RF-70', () => {
    it('422 BID_BELOW_MINIMUM com details.minAmountCents', async () => {
      const lotId = await createLot();
      const response = await placeBid(lotId, ana.token, 9_999);
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({
        error: {
          code: 'BID_BELOW_MINIMUM',
          message: 'O primeiro lance precisa ser de pelo menos R$ 100,00 (o lance inicial).',
          details: { minAmountCents: 10_000 },
        },
      });
    });

    it('422 INSUFFICIENT_FUNDS com details.availableCents', async () => {
      const lotId = await createLot();
      const poor = await bidder('Sem Saldo', 5_000);
      const response = await placeBid(lotId, poor.token, 10_000);
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({
        error: {
          code: 'INSUFFICIENT_FUNDS',
          message: 'Saldo insuficiente: você tem R$ 50,00 disponíveis para lances.',
          details: { availableCents: 5_000 },
        },
      });
    });

    it('409 ALREADY_WINNING', async () => {
      const lotId = await createLot();
      await placeBid(lotId, ana.token, 10_000);
      const response = await placeBid(lotId, ana.token, 20_000);
      expect(response.statusCode).toBe(409);
      expect(response.json().error).toEqual({
        code: 'ALREADY_WINNING',
        message: 'Você já lidera este lote. Espere outro licitante cobrir o seu lance.',
      });
    });

    it('409 LOT_NOT_STARTED, LOT_ENDED e LOT_CANCELED', async () => {
      const scheduled = await createLot({
        startsAt: new Date(Date.now() + HOUR),
        endsAt: new Date(Date.now() + 2 * HOUR),
      });
      const ended = await createLot({
        startsAt: new Date(Date.now() - 2 * HOUR),
        endsAt: new Date(Date.now() - MINUTE),
      });
      const canceled = await createLot({ canceledAt: new Date() });

      for (const [lotId, code] of [
        [scheduled, 'LOT_NOT_STARTED'],
        [ended, 'LOT_ENDED'],
        [canceled, 'LOT_CANCELED'],
      ] as const) {
        const response = await placeBid(lotId, ana.token, 10_000);
        expect(response.statusCode).toBe(409);
        expect(response.json().error.code).toBe(code);
        expect(response.json().error.message).toEqual(expect.any(String));
      }
    });

    it('T-08: leiloeiro → 403 FORBIDDEN; sem token → 401; nada gravado', async () => {
      const lotId = await createLot();
      const forbidden = await placeBid(lotId, auctioneer.token, 10_000);
      expect(forbidden.statusCode).toBe(403);
      expect(forbidden.json().error.code).toBe('FORBIDDEN');

      const anonymous = await placeBid(lotId, null, 10_000);
      expect(anonymous.statusCode).toBe(401);
      expect(anonymous.json().error.code).toBe('UNAUTHORIZED');
      expect(await prisma.bid.count({ where: { lotId } })).toBe(0);
    });

    it('404 LOT_NOT_FOUND (id inexistente ou inválido)', async () => {
      for (const id of [randomUUID(), 'nao-existe']) {
        const response = await placeBid(id, ana.token, 10_000);
        expect(response.statusCode).toBe(404);
        expect(response.json().error.code).toBe('LOT_NOT_FOUND');
      }
    });

    it('400 VALIDATION_ERROR: sem Idempotency-Key, valor não inteiro, zero ou sem corpo', async () => {
      const lotId = await createLot();
      const noKey = await placeBid(lotId, ana.token, 10_000, null);
      expect(noKey.statusCode).toBe(400);
      expect(noKey.json().error.code).toBe('VALIDATION_ERROR');

      for (const amount of [100.5, 0, '10000', undefined]) {
        const response = await placeBid(lotId, ana.token, amount);
        expect(response.statusCode).toBe(400);
        expect(response.json().error.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  it('RN-08 pela API: quem é coberto recebe o valor de volta na hora', async () => {
    const lotId = await createLot();
    const before = (
      await app.inject({ method: 'GET', url: '/wallet', headers: auth(bruno.token) })
    ).json();
    await placeBid(lotId, bruno.token, 10_000);
    const covered = await placeBid(lotId, ana.token, 10_500);
    expect(covered.statusCode).toBe(201);

    const after = (
      await app.inject({ method: 'GET', url: '/wallet', headers: auth(bruno.token) })
    ).json();
    expect(after.availableCents).toBe(before.availableCents);

    const movements = (
      await app.inject({ method: 'GET', url: '/wallet/movements', headers: auth(bruno.token) })
    ).json().items;
    expect(movements.slice(0, 2)).toMatchObject([
      { type: 'RELEASE', amountCents: 10_000, lotId },
      { type: 'COMMIT', amountCents: 10_000, lotId },
    ]);
  });

  it('T-09: GET /lots/:id/bids é público, em seq decrescente, sem nome, e-mail, id, hash nem selo', async () => {
    const lotId = await createLot();
    await placeBid(lotId, ana.token, 10_000);
    await placeBid(lotId, bruno.token, 11_000);
    await placeBid(lotId, ana.token, 12_000);

    const response = await app.inject({ method: 'GET', url: `/lots/${lotId}/bids` });
    expect(response.statusCode).toBe(200);
    const { items } = response.json();
    expect(items.map((i: { seq: number }) => i.seq)).toEqual([3, 2, 1]);
    expect(items.map((i: { amountCents: number }) => i.amountCents)).toEqual([
      12_000, 11_000, 10_000,
    ]);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(['amountCents', 'createdAt', 'pseudonym', 'seq']);
    }
    // Mesmo licitante, mesmo pseudônimo no lote; licitantes diferentes, pseudônimos diferentes.
    expect(items[0].pseudonym).toBe(items[2].pseudonym);
    expect(items[0].pseudonym).not.toBe(items[1].pseudonym);

    const lot = (await app.inject({ method: 'GET', url: `/lots/${lotId}` })).json().lot;
    expect(lot.leaderPseudonym).toBe(items[0].pseudonym);

    const bids = await prisma.bid.findMany({ where: { lotId } });
    const publicText = response.body + JSON.stringify(lot);
    for (const secret of [ana.id, bruno.id, ana.email, bruno.email, ana.name, bruno.name]) {
      expect(publicText).not.toContain(secret);
    }
    for (const bid of bids) {
      expect(publicText).not.toContain(bid.hash);
      expect(publicText).not.toContain(bid.seal);
    }
  });

  it('GET /lots/:id/bids: lote sem lances → lista vazia; inexistente → 404', async () => {
    const lotId = await createLot();
    const empty = await app.inject({ method: 'GET', url: `/lots/${lotId}/bids` });
    expect(empty.json()).toEqual({ items: [] });
    const missing = await app.inject({ method: 'GET', url: `/lots/${randomUUID()}/bids` });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('LOT_NOT_FOUND');
  });

  it('cancelamento pela API: lote com lance → 409 LOT_NOT_CANCELABLE', async () => {
    const lotId = await createLot();
    await placeBid(lotId, ana.token, 10_000);
    const response = await app.inject({
      method: 'POST',
      url: `/lots/${lotId}/cancel`,
      headers: auth(auctioneer.token),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toEqual({
      code: 'LOT_NOT_CANCELABLE',
      message: 'O lote já tem lances e não pode ser cancelado.',
    });
  });

  it('seed: o lote ao vivo tem lances com cadeia certa e pseudônimos', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/lots/5eed0000-0000-4000-8000-000000000001/bids',
    });
    const { items } = response.json();
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items.at(-1)).toMatchObject({ seq: 1, amountCents: 50_000 });
  });
});
