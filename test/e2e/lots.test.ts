import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { AIC_USER_AGENT } from '../../src/infra/external/artic-item-catalog.ts';
import { prisma } from '../../src/infra/repositories/prisma/prisma-client.ts';
import { getItemAuction } from '../../src/domain/entities/item-auction.ts';
import { ItemAlreadyAuctionedError } from '../../src/domain/errors/item-already-auctioned-error.ts';
import type { LotBidsReader } from '../../src/domain/repositories/lot-bids-reader.ts';
import { PrismaLotsRepository } from '../../src/infra/repositories/prisma/prisma-lots-repository.ts';
import { registerUser } from './helpers.ts';
import {
  IMG_900001,
  IMG_900003,
  MOCK_IMAGE,
  searchByIds,
  startItemsApiMock,
  uniqueExternalId,
  type ItemsApiMock,
} from './items-api-mock.ts';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

/** Lances simulados (os reais chegam no I2): marca um lote como arrematado (RN-19). */
const lotsWithBids = new Set<string>();
const fakeBidsReader: LotBidsReader = {
  hasBids: async (lotId) => lotsWithBids.has(lotId),
  listLotIdsWithBids: async (lotIds) => new Set(lotIds.filter((id) => lotsWithBids.has(id))),
};

describe('lotes e API de itens (RF-10, RF-20 a RF-22, RF-25)', () => {
  let app: FastifyInstance;
  let mock: ItemsApiMock;
  let auctioneerA: { token: string; id: string };
  let auctioneerB: { token: string; id: string };
  /** Segundo leiloeiro dos testes da RN-19 (o B é conferido em GET /auctioneer/lots). */
  let auctioneerC: { token: string; id: string };
  let bidder: { token: string };

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  async function createLot(token: string, overrides: Record<string, unknown> = {}) {
    return app.inject({
      method: 'POST',
      url: '/lots',
      headers: auth(token),
      payload: {
        // RN-19: uma obra só tem um lote vivo; cada lote de teste usa uma obra própria.
        externalId: uniqueExternalId(),
        startingBidCents: 10_000,
        minIncrementCents: 500,
        startsAt: iso(0),
        endsAt: iso(HOUR),
        ...overrides,
      },
    });
  }

  /** Lote encerrado gravado direto no banco (a rota não deixa criar no passado). */
  async function insertEndedLot(auctioneerId: string, endedMsAgo: number, externalId = '900003') {
    const endsAt = new Date(Date.now() - endedMsAgo);
    return prisma.lot.create({
      data: {
        auctioneerId,
        externalId,
        title: 'Encerrado de teste',
        attributes: {},
        imageData: new Uint8Array(MOCK_IMAGE),
        imageContentType: 'image/png',
        startingBidCents: 1_000,
        minIncrementCents: 100,
        startsAt: new Date(endsAt.getTime() - HOUR),
        originalEndsAt: endsAt,
        endsAt,
      },
    });
  }

  beforeAll(async () => {
    mock = await startItemsApiMock(300);
    app = await buildApp({ itemCatalog: mock.catalog, lotBidsReader: fakeBidsReader });
    await app.ready();

    const a = (await registerUser(app, { role: 'AUCTIONEER' })).response.json();
    const b = (await registerUser(app, { role: 'AUCTIONEER' })).response.json();
    const c = (await registerUser(app, { role: 'BIDDER' })).response.json();
    const d = (await registerUser(app, { role: 'AUCTIONEER' })).response.json();
    auctioneerC = { token: d.token, id: d.user.id };
    auctioneerA = { token: a.token, id: a.user.id };
    auctioneerB = { token: b.token, id: b.user.id };
    bidder = { token: c.token };
  });

  beforeEach(() => {
    mock.setMode('ok');
  });

  afterAll(async () => {
    await app.close();
    await mock.close();
    await prisma.$disconnect();
  });

  describe('GET /items/search (RF-20)', () => {
    it('leiloeiro busca e recebe só itens com imagem, com miniatura pela API e atributos', async () => {
      mock.requests.length = 0;
      const response = await app.inject({
        method: 'GET',
        url: '/items/search?q=paisagem&page=1',
        headers: auth(auctioneerA.token),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.page).toBe(1);
      expect(body.items.map((item: { externalId: string }) => item.externalId)).toEqual([
        '900001',
        '900003',
        '900004',
      ]);
      expect(body.items[0]).toEqual({
        externalId: '900001',
        title: 'Paisagem simulada',
        imageUrl: `/items/images/${IMG_900001}/thumbnail`,
        attributes: {
          artist: 'Pintora Teste\nBrasil, 1850–1920',
          date: '1890',
          medium: 'Óleo sobre tela',
          dimensions: '50 × 70 cm',
          placeOfOrigin: 'Brasil',
        },
        auction: null,
      });

      const [call] = mock.requests;
      expect(call?.url).toContain('/api/v1/artworks/search?');
      expect(call?.url).toContain('q=paisagem');
      expect(call?.url).toContain('fields=id%2Ctitle%2Cimage_id');
      expect(call?.headers['aic-user-agent']).toBe(AIC_USER_AGENT);
    });

    it('licitante → 403 FORBIDDEN; sem token → 401', async () => {
      const asBidder = await app.inject({
        method: 'GET',
        url: '/items/search?q=x',
        headers: auth(bidder.token),
      });
      expect(asBidder.statusCode).toBe(403);
      expect(asBidder.json().error.code).toBe('FORBIDDEN');

      const anonymous = await app.inject({ method: 'GET', url: '/items/search?q=x' });
      expect(anonymous.statusCode).toBe(401);
    });
  });

  describe('GET /items/images/:imageId/thumbnail (RF-20)', () => {
    it('pública: baixa a miniatura de 400 px no IIIF e devolve bytes com cache longo', async () => {
      mock.requests.length = 0;
      const response = await app.inject({
        method: 'GET',
        url: `/items/images/${IMG_900001}/thumbnail`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('image/png');
      expect(response.headers['cache-control']).toBe('public, max-age=604800, immutable');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(Buffer.compare(response.rawPayload, MOCK_IMAGE)).toBe(0);

      expect(mock.requests).toHaveLength(1);
      expect(mock.requests[0]?.url).toBe(`/iiif/2/${IMG_900001}/full/400,/0/default.jpg`);
      expect(mock.requests[0]?.headers['aic-user-agent']).toBe(AIC_USER_AGENT);
    });

    it('a URL de miniatura que a busca devolve funciona', async () => {
      const search = await app.inject({
        method: 'GET',
        url: '/items/search?q=x',
        headers: auth(auctioneerA.token),
      });
      const { imageUrl } = search.json().items[0];
      const response = await app.inject({ method: 'GET', url: imageUrl });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('image/png');
    });

    it.each([
      ['texto qualquer', 'img-900001'],
      ['tentativa de caminho', '..%2F..%2Fapi%2Fv1%2Fartworks'],
      ['URL externa', encodeURIComponent('http://169.254.169.254/latest')],
      ['UUID com sufixo', `${IMG_900001}x`],
    ])('id inválido (%s) → 400 sem chamar a API de itens', async (_label, imageId) => {
      mock.requests.length = 0;
      const response = await app.inject({
        method: 'GET',
        url: `/items/images/${imageId}/thumbnail`,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
      expect(mock.requests).toHaveLength(0);
    });

    it('imagem que a AIC não tem → 404 ITEM_NOT_FOUND, sem cache', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/items/images/0a000000-0000-4000-8000-0000000fffff/thumbnail',
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('ITEM_NOT_FOUND');
      expect(response.headers['cache-control']).toBeUndefined();
    });

    // IMG_900003: o IMG_900001 já está no cache da miniatura e não iria à AIC.
    it('AIC fora do ar → 502 EXTERNAL_API_UNAVAILABLE, sem vazar detalhes', async () => {
      mock.setMode('down');
      const response = await app.inject({
        method: 'GET',
        url: `/items/images/${IMG_900003}/thumbnail`,
      });
      expect(response.statusCode).toBe(502);
      const body = response.json();
      expect(body.error.code).toBe('EXTERNAL_API_UNAVAILABLE');
      expect(JSON.stringify(body)).not.toMatch(/127\.0\.0\.1|iiif|fora do ar/);
      expect(response.headers['cache-control']).toBeUndefined();
    });

    it('AIC lenta → 502 pelo timeout', async () => {
      mock.setMode('slow');
      const response = await app.inject({
        method: 'GET',
        url: `/items/images/${IMG_900003}/thumbnail`,
      });
      expect(response.statusCode).toBe(502);
      expect(response.json().error.code).toBe('EXTERNAL_API_UNAVAILABLE');
    });

    it('falha não fica no cache: com a AIC de volta, o mesmo id responde 200', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/items/images/${IMG_900003}/thumbnail`,
      });
      expect(response.statusCode).toBe(200);
      expect(Buffer.compare(response.rawPayload, MOCK_IMAGE)).toBe(0);
    });
  });

  describe('POST /lots (RF-21)', () => {
    it('início agora → 201 ao vivo, com a imagem copiada para o banco e sem dados do leiloeiro', async () => {
      const response = await createLot(auctioneerA.token);

      expect(response.statusCode).toBe(201);
      const lot = response.json();
      expect(lot).toEqual({
        id: expect.any(String),
        title: 'Paisagem simulada',
        attributes: expect.objectContaining({ artist: 'Pintora Teste\nBrasil, 1850–1920' }),
        imageUrl: `/lots/${lot.id}/image`,
        startingBidCents: 10_000,
        minIncrementCents: 500,
        currentBidCents: null,
        minNextBidCents: 10_000,
        leaderPseudonym: null,
        startsAt: expect.any(String),
        originalEndsAt: lot.endsAt,
        endsAt: expect.any(String),
        status: 'LIVE',
        canceledAt: null,
      });
      expect(response.body).not.toContain(auctioneerA.id);

      const stored = await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(Buffer.from(stored.imageData).equals(MOCK_IMAGE)).toBe(true);
      expect(stored.imageContentType).toBe('image/png');
      expect(stored.auctioneerId).toBe(auctioneerA.id);
    });

    it('título e atributos copiados da obra 900001', async () => {
      const response = await createLot(auctioneerA.token, { externalId: '900001' });
      expect(response.statusCode).toBe(201);
      expect(response.json().title).toBe('Paisagem simulada');
      // Libera a obra para o teste do MCP, que cria o primeiro item da busca (RN-19).
      await app.inject({
        method: 'POST',
        url: `/lots/${response.json().id}/cancel`,
        headers: auth(auctioneerA.token),
      });
    });

    it('início no futuro → agendado', async () => {
      const response = await createLot(auctioneerA.token, {
        startsAt: iso(HOUR),
        endsAt: iso(2 * HOUR),
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().status).toBe('SCHEDULED');
    });

    it('início até 60 s no passado é aceito (tolerância)', async () => {
      const response = await createLot(auctioneerA.token, { startsAt: iso(-30_000) });
      expect(response.statusCode).toBe(201);
    });

    it('Q-07: início no passado e duração menor que 5 min → 400 com mensagem clara', async () => {
      const past = await createLot(auctioneerA.token, { startsAt: iso(-5 * MINUTE) });
      expect(past.statusCode).toBe(400);
      expect(past.json().error).toEqual({
        code: 'VALIDATION_ERROR',
        message: 'O início do lote não pode estar no passado.',
      });

      const short = await createLot(auctioneerA.token, {
        startsAt: iso(HOUR),
        endsAt: iso(HOUR + 4 * MINUTE),
      });
      expect(short.statusCode).toBe(400);
      expect(short.json().error.message).toBe(
        'O fim do lote precisa ser pelo menos 5 minutos depois do início.',
      );

      const exactlyFive = await createLot(auctioneerA.token, {
        startsAt: iso(HOUR),
        endsAt: new Date(new Date(iso(HOUR)).getTime() + 5 * MINUTE).toISOString(),
      });
      expect(exactlyFive.statusCode).toBe(201);
    });

    it('Q-06 e RN-16: lance inicial e incremento inteiros > 0 em centavos', async () => {
      for (const overrides of [
        { startingBidCents: 0 },
        { startingBidCents: -100 },
        { startingBidCents: 10.5 },
        { startingBidCents: '1000' },
        { minIncrementCents: 0 },
        { startsAt: 'amanhã' },
        { externalId: undefined },
      ]) {
        const response = await createLot(auctioneerA.token, overrides);
        expect(response.statusCode, JSON.stringify(overrides)).toBe(400);
        expect(response.json().error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('RF-40: sem corpo ou corpo que não é objeto → 400 com mensagem em português', async () => {
      const message = 'Envie os dados do lote no corpo da requisição, em JSON.';
      const noBody = await app.inject({
        method: 'POST',
        url: '/lots',
        headers: auth(auctioneerA.token),
      });
      const notObject = await app.inject({
        method: 'POST',
        url: '/lots',
        headers: { ...auth(auctioneerA.token), 'content-type': 'application/json' },
        payload: '[1, 2]',
      });
      for (const response of [noBody, notObject]) {
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({
          error: { code: 'VALIDATION_ERROR', message, details: [{ path: '', message }] },
        });
      }
    });

    it('item inexistente ou sem imagem → 404 ITEM_NOT_FOUND e nada gravado', async () => {
      const before = await prisma.lot.count();
      for (const externalId of ['123456789', '900002', 'abc']) {
        const response = await createLot(auctioneerA.token, { externalId });
        expect(response.statusCode).toBe(404);
        expect(response.json().error.code).toBe('ITEM_NOT_FOUND');
      }
      expect(await prisma.lot.count()).toBe(before);
    });

    it('imagem acima do limite → 422 ITEM_IMAGE_TOO_LARGE e nada gravado', async () => {
      const before = await prisma.lot.count();
      const response = await createLot(auctioneerA.token, { externalId: '900004' });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('ITEM_IMAGE_TOO_LARGE');
      expect(await prisma.lot.count()).toBe(before);
    });

    it('licitante → 403; sem token → 401', async () => {
      expect((await createLot(bidder.token)).statusCode).toBe(403);
      const anonymous = await app.inject({ method: 'POST', url: '/lots', payload: {} });
      expect(anonymous.statusCode).toBe(401);
    });
  });

  describe('uma obra, um lote vivo (RN-19)', () => {
    const cancel = (id: string, token = auctioneerA.token) =>
      app.inject({ method: 'POST', url: `/lots/${id}/cancel`, headers: auth(token) });

    it('agendado prende a obra para qualquer leiloeiro → 409 ITEM_ALREADY_AUCTIONED, sem chamar a API', async () => {
      const externalId = uniqueExternalId();
      const lot = (
        await createLot(auctioneerA.token, {
          externalId,
          startsAt: iso(HOUR),
          endsAt: iso(2 * HOUR),
        })
      ).json();
      const before = await prisma.lot.count();
      mock.requests.length = 0;

      for (const token of [auctioneerA.token, auctioneerC.token]) {
        const response = await createLot(token, { externalId });
        expect(response.statusCode).toBe(409);
        expect(response.json()).toEqual({
          error: {
            code: 'ITEM_ALREADY_AUCTIONED',
            message:
              'Esta obra já tem um lote agendado. Uma obra só pode estar em um lote por vez: ' +
              'para leiloá-la em outro lote, o lote atual precisa ser cancelado.',
            details: { status: 'SCHEDULED', lotId: lot.id },
          },
        });
      }
      expect(await prisma.lot.count()).toBe(before);
      expect(mock.requests).toHaveLength(0);
    });

    it('ao vivo prende a obra → 409 com status LIVE', async () => {
      const externalId = uniqueExternalId();
      const lot = (await createLot(auctioneerA.token, { externalId })).json();
      expect(lot.status).toBe('LIVE');

      const response = await createLot(auctioneerC.token, {
        externalId,
        startsAt: iso(3 * HOUR),
        endsAt: iso(4 * HOUR),
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error).toEqual({
        code: 'ITEM_ALREADY_AUCTIONED',
        message:
          'Esta obra já está em leilão em um lote ao vivo. Uma obra só pode estar em um lote por vez.',
        details: { status: 'LIVE', lotId: lot.id },
      });
    });

    it('arrematado (encerrado com lances) prende para sempre → 409 com status SOLD', async () => {
      const externalId = uniqueExternalId();
      const sold = await insertEndedLot(auctioneerA.id, HOUR, externalId);
      lotsWithBids.add(sold.id);

      const response = await createLot(auctioneerA.token, { externalId });
      expect(response.statusCode).toBe(409);
      expect(response.json().error).toEqual({
        code: 'ITEM_ALREADY_AUCTIONED',
        message: 'Esta obra já foi vendida em leilão e não pode ser leiloada de novo.',
        details: { status: 'SOLD', lotId: sold.id },
      });
    });

    it('cancelado libera → 201; o lote novo prende de novo', async () => {
      const externalId = uniqueExternalId();
      const first = (await createLot(auctioneerA.token, { externalId })).json();
      expect((await cancel(first.id)).statusCode).toBe(200);

      const second = await createLot(auctioneerC.token, { externalId });
      expect(second.statusCode).toBe(201);
      const third = await createLot(auctioneerA.token, { externalId });
      expect(third.statusCode).toBe(409);
      expect(third.json().error.details).toEqual({ status: 'LIVE', lotId: second.json().id });
    });

    it('encerrado sem lances libera → 201', async () => {
      const externalId = uniqueExternalId();
      await insertEndedLot(auctioneerA.id, MINUTE, externalId);
      await insertEndedLot(auctioneerA.id, 2 * HOUR, externalId);
      const response = await createLot(auctioneerC.token, { externalId });
      expect(response.statusCode).toBe(201);
    });

    it('corrida: 5 criações simultâneas da mesma obra → 1 lote (201) e 4 × 409', async () => {
      const externalId = uniqueExternalId();
      const responses = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          createLot(i % 2 === 0 ? auctioneerA.token : auctioneerC.token, { externalId }),
        ),
      );
      const statuses = responses.map((response) => response.statusCode).sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409]);

      const created = responses.find((response) => response.statusCode === 201)!.json();
      for (const response of responses.filter((r) => r.statusCode === 409)) {
        expect(response.json().error.details).toEqual({ status: 'LIVE', lotId: created.id });
      }
      expect(await prisma.lot.count({ where: { externalId } })).toBe(1);
    });

    it('trava da obra no repositório: com a checagem lenta, a segunda criação espera e vê a primeira', async () => {
      const repository = new PrismaLotsRepository();
      const externalId = uniqueExternalId();
      const data = {
        auctioneerId: auctioneerA.id,
        externalId,
        title: 'Corrida',
        attributes: {
          artist: null,
          date: null,
          medium: null,
          dimensions: null,
          placeOfOrigin: null,
        },
        image: { data: new Uint8Array(MOCK_IMAGE), contentType: 'image/png' },
        startingBidCents: 1_000,
        minIncrementCents: 100,
        startsAt: new Date(Date.now() + HOUR),
        endsAt: new Date(Date.now() + 2 * HOUR),
      };
      // Janela larga entre a leitura e a gravação: sem a trava, as duas leriam "nenhum lote".
      const slowGuard = async (lotsOfItem: Parameters<typeof getItemAuction>[0]) => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const auction = getItemAuction(lotsOfItem, new Date(), new Set());
        if (auction) throw new ItemAlreadyAuctionedError(auction);
      };

      const results = await Promise.allSettled([
        repository.create(data, slowGuard),
        repository.create(data, slowGuard),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
      const rejected = results.find((result) => result.status === 'rejected');
      expect(rejected?.reason).toBeInstanceOf(ItemAlreadyAuctionedError);
      expect(await prisma.lot.count({ where: { externalId } })).toBe(1);
    });

    it('busca traz a situação e o lote de cada obra', async () => {
      const [scheduledId, liveId, soldId, canceledId, endedId, freeId] = Array.from(
        { length: 6 },
        uniqueExternalId,
      );
      const scheduled = (
        await createLot(auctioneerA.token, {
          externalId: scheduledId,
          startsAt: iso(HOUR),
          endsAt: iso(2 * HOUR),
        })
      ).json();
      const live = (await createLot(auctioneerC.token, { externalId: liveId })).json();
      const sold = await insertEndedLot(auctioneerA.id, HOUR, soldId);
      lotsWithBids.add(sold.id);
      // Outro lote da mesma obra, encerrado sem lances: não muda a situação de vendida.
      await insertEndedLot(auctioneerA.id, 2 * HOUR, soldId);
      const canceled = (await createLot(auctioneerA.token, { externalId: canceledId })).json();
      await cancel(canceled.id);
      await insertEndedLot(auctioneerA.id, MINUTE, endedId);

      const ids = [scheduledId, liveId, soldId, canceledId, endedId, freeId] as string[];
      const response = await app.inject({
        method: 'GET',
        url: `/items/search?q=${encodeURIComponent(searchByIds(ids))}`,
        headers: auth(auctioneerA.token),
      });
      expect(response.statusCode).toBe(200);
      const auctionById = Object.fromEntries(
        response
          .json()
          .items.map((item: { externalId: string; auction: unknown }) => [
            item.externalId,
            item.auction,
          ]),
      );
      expect(auctionById).toEqual({
        [scheduledId!]: { status: 'SCHEDULED', lotId: scheduled.id },
        [liveId!]: { status: 'LIVE', lotId: live.id },
        [soldId!]: { status: 'SOLD', lotId: sold.id },
        [canceledId!]: null,
        [endedId!]: null,
        [freeId!]: null,
      });
    });
  });

  describe('vitrine, lote e imagem (RF-10, RN-13)', () => {
    it('GET /lots separa ao vivo, agendado e encerrado, ordena e deixa cancelados fora', async () => {
      const liveSoon = (await createLot(auctioneerA.token, { endsAt: iso(10 * MINUTE) })).json();
      const liveLate = (await createLot(auctioneerA.token, { endsAt: iso(3 * HOUR) })).json();
      const schedFar = (
        await createLot(auctioneerA.token, { startsAt: iso(5 * HOUR), endsAt: iso(6 * HOUR) })
      ).json();
      const schedNear = (
        await createLot(auctioneerA.token, { startsAt: iso(4 * HOUR), endsAt: iso(6 * HOUR) })
      ).json();
      const canceled = (await createLot(auctioneerA.token)).json();
      await app.inject({
        method: 'POST',
        url: `/lots/${canceled.id}/cancel`,
        headers: auth(auctioneerA.token),
      });
      const endedOld = await insertEndedLot(auctioneerA.id, 2 * HOUR);
      const endedRecent = await insertEndedLot(auctioneerA.id, MINUTE);

      const response = await app.inject({ method: 'GET', url: '/lots' });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Date.parse(body.serverTime)).not.toBeNaN();

      const ids = (list: { id: string }[]) => list.map((lot) => lot.id);
      const all = [...ids(body.live), ...ids(body.scheduled), ...ids(body.ended)];
      expect(all).not.toContain(canceled.id);

      const live = ids(body.live);
      expect(live.indexOf(liveSoon.id)).toBeLessThan(live.indexOf(liveLate.id));
      expect(live.indexOf(liveSoon.id)).toBeGreaterThanOrEqual(0);
      const scheduled = ids(body.scheduled);
      expect(scheduled.indexOf(schedNear.id)).toBeGreaterThanOrEqual(0);
      expect(scheduled.indexOf(schedNear.id)).toBeLessThan(scheduled.indexOf(schedFar.id));
      const ended = ids(body.ended);
      expect(ended.indexOf(endedRecent.id)).toBeGreaterThanOrEqual(0);
      expect(ended.indexOf(endedRecent.id)).toBeLessThan(ended.indexOf(endedOld.id));

      for (const lot of body.live) expect(lot.status).toBe('LIVE');
      for (const lot of body.scheduled) expect(lot.status).toBe('SCHEDULED');
      for (const lot of body.ended) expect(lot.status).toBe('ENDED');
    });

    it('seed: há lotes do leiloeiro de teste ao vivo, agendado e encerrado', async () => {
      const body = (await app.inject({ method: 'GET', url: '/lots' })).json();
      const find = (list: { title: string }[], title: string) =>
        list.some((lot) => lot.title === title);
      expect(find(body.live, 'Entardecer sobre as colinas')).toBe(true);
      expect(find(body.scheduled, 'Composição em vermelho, amarelo e azul')).toBe(true);
      expect(find(body.ended, 'Natureza-morta com vaso azul')).toBe(true);
    });

    it('GET /lots/:id → { serverTime, lot }; inexistente → 404', async () => {
      const created = (await createLot(auctioneerA.token)).json();
      const response = await app.inject({ method: 'GET', url: `/lots/${created.id}` });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ serverTime: expect.any(String), lot: created });

      for (const id of ['00000000-0000-4000-8000-000000000000', 'nao-e-uuid']) {
        const missing = await app.inject({ method: 'GET', url: `/lots/${id}` });
        expect(missing.statusCode).toBe(404);
        expect(missing.json().error.code).toBe('LOT_NOT_FOUND');
      }
    });

    it('GET /lots/:id/image serve os bytes do banco com content-type e cache', async () => {
      const created = (await createLot(auctioneerA.token)).json();
      const response = await app.inject({ method: 'GET', url: created.imageUrl });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('image/png');
      expect(response.headers['cache-control']).toBe('public, max-age=86400');
      expect(response.rawPayload.equals(MOCK_IMAGE)).toBe(true);

      const missing = await app.inject({
        method: 'GET',
        url: '/lots/00000000-0000-4000-8000-000000000000/image',
      });
      expect(missing.statusCode).toBe(404);
    });
  });

  describe('API externa fora (T-07, RN-13)', () => {
    it('busca e criação → 502 EXTERNAL_API_UNAVAILABLE claro; vitrine, lote e imagem seguem 200 sem chamar a API', async () => {
      const lot = (await createLot(auctioneerA.token)).json();
      const before = await prisma.lot.count();
      mock.setMode('down');

      const search = await app.inject({
        method: 'GET',
        url: '/items/search?q=x',
        headers: auth(auctioneerA.token),
      });
      expect(search.statusCode).toBe(502);
      expect(search.json().error).toEqual({
        code: 'EXTERNAL_API_UNAVAILABLE',
        message: expect.stringContaining('API de itens'),
      });

      const create = await createLot(auctioneerA.token);
      expect(create.statusCode).toBe(502);
      expect(create.json().error.code).toBe('EXTERNAL_API_UNAVAILABLE');
      expect(await prisma.lot.count()).toBe(before);

      mock.requests.length = 0;
      for (const url of ['/lots', `/lots/${lot.id}`, `/lots/${lot.id}/image`]) {
        expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(200);
      }
      expect(mock.requests).toHaveLength(0);
    });

    it('API lenta → 502 após o timeout, com mensagem de tempo esgotado', async () => {
      mock.setMode('slow');
      const startedAt = Date.now();
      const search = await app.inject({
        method: 'GET',
        url: '/items/search?q=lento',
        headers: auth(auctioneerA.token),
      });
      expect(search.statusCode).toBe(502);
      expect(search.json().error.message).toContain('não respondeu em 0.3 s');
      expect(Date.now() - startedAt).toBeLessThan(5_000);
    });
  });

  describe('cancelamento e posse (RF-22, RF-25, RN-12, T-08)', () => {
    it('dono cancela agendado e ao vivo → 200 CANCELED; de novo → 409', async () => {
      const scheduled = (
        await createLot(auctioneerA.token, { startsAt: iso(HOUR), endsAt: iso(2 * HOUR) })
      ).json();
      const live = (await createLot(auctioneerA.token)).json();

      for (const lot of [scheduled, live]) {
        const response = await app.inject({
          method: 'POST',
          url: `/lots/${lot.id}/cancel`,
          headers: auth(auctioneerA.token),
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ id: lot.id, status: 'CANCELED' });
        expect(response.json().canceledAt).toEqual(expect.any(String));

        const detail = await app.inject({ method: 'GET', url: `/lots/${lot.id}` });
        expect(detail.json().lot.status).toBe('CANCELED');
      }

      const again = await app.inject({
        method: 'POST',
        url: `/lots/${live.id}/cancel`,
        headers: auth(auctioneerA.token),
      });
      expect(again.statusCode).toBe(409);
      expect(again.json().error).toEqual({
        code: 'LOT_NOT_CANCELABLE',
        message: 'O lote já está cancelado.',
      });
    });

    it('encerrado → 409 com motivo', async () => {
      const ended = await insertEndedLot(auctioneerA.id, MINUTE);
      const response = await app.inject({
        method: 'POST',
        url: `/lots/${ended.id}/cancel`,
        headers: auth(auctioneerA.token),
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.message).toBe(
        'O lote já foi encerrado e não pode ser cancelado.',
      );
    });

    it('leiloeiro B não cancela lote do A (403) e licitante também não; inexistente → 404', async () => {
      const lot = (await createLot(auctioneerA.token)).json();

      const byB = await app.inject({
        method: 'POST',
        url: `/lots/${lot.id}/cancel`,
        headers: auth(auctioneerB.token),
      });
      expect(byB.statusCode).toBe(403);
      expect(byB.json().error.code).toBe('FORBIDDEN');

      const byBidder = await app.inject({
        method: 'POST',
        url: `/lots/${lot.id}/cancel`,
        headers: auth(bidder.token),
      });
      expect(byBidder.statusCode).toBe(403);

      const missing = await app.inject({
        method: 'POST',
        url: '/lots/00000000-0000-4000-8000-000000000000/cancel',
        headers: auth(auctioneerA.token),
      });
      expect(missing.statusCode).toBe(404);

      const detail = await app.inject({ method: 'GET', url: `/lots/${lot.id}` });
      expect(detail.json().lot.status).toBe('LIVE');
    });

    it('GET /auctioneer/lots: só os lotes do próprio leiloeiro, inclusive cancelados', async () => {
      const mine = (await createLot(auctioneerB.token)).json();
      const mineCanceled = (await createLot(auctioneerB.token)).json();
      await app.inject({
        method: 'POST',
        url: `/lots/${mineCanceled.id}/cancel`,
        headers: auth(auctioneerB.token),
      });
      const others = (await createLot(auctioneerA.token)).json();

      const response = await app.inject({
        method: 'GET',
        url: '/auctioneer/lots',
        headers: auth(auctioneerB.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Date.parse(body.serverTime)).not.toBeNaN();
      const ids = body.items.map((lot: { id: string }) => lot.id);
      expect(ids).toHaveLength(2);
      expect(ids).toEqual(expect.arrayContaining([mine.id, mineCanceled.id]));
      expect(ids).not.toContain(others.id);
      expect(body.items.find((lot: { id: string }) => lot.id === mineCanceled.id).status).toBe(
        'CANCELED',
      );

      const asBidder = await app.inject({
        method: 'GET',
        url: '/auctioneer/lots',
        headers: auth(bidder.token),
      });
      expect(asBidder.statusCode).toBe(403);
      expect((await app.inject({ method: 'GET', url: '/auctioneer/lots' })).statusCode).toBe(401);
    });
  });
});
