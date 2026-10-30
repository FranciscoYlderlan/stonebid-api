import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { PlaceBidUseCase } from '../../src/application/use-cases/place-bid.ts';
import type { ItemCatalog } from '../../src/domain/catalog/item-catalog.ts';
import { ExternalApiUnavailableError } from '../../src/domain/errors/external-api-unavailable-error.ts';
import { PrismaBidsRepository } from '../../src/infra/repositories/prisma/prisma-bids-repository.ts';
import { prisma } from '../../src/infra/repositories/prisma/prisma-client.ts';
import { PrismaWalletRepository } from '../../src/infra/repositories/prisma/prisma-wallet-repository.ts';
import { testEnv } from '../test-env.ts';
import { registerUser } from './helpers.ts';
import { MOCK_IMAGE } from './items-api-mock.ts';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const secrets = { sealSecret: testEnv.SEAL_SECRET, pseudonymSecret: testEnv.PSEUDONYM_SECRET };

/** API de itens fora do ar (T-07): qualquer chamada falha e é contada. */
function downCatalog() {
  let calls = 0;
  const fail = async (): Promise<never> => {
    calls++;
    throw new ExternalApiUnavailableError('API de itens fora do ar (teste).');
  };
  const catalog: ItemCatalog = {
    search: fail,
    findById: fail,
    downloadImage: fail,
    downloadThumbnail: fail,
  };
  return { catalog, calls: () => calls };
}

describe('liquidação na leitura, comprovante, meus lances e total do leiloeiro (I3)', () => {
  let app: FastifyInstance;
  const external = downCatalog();
  let auctioneer: { token: string; id: string };
  let ana: { token: string; id: string; email: string; name: string };
  let bruno: { token: string; id: string; email: string; name: string };

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  async function bidder(name: string) {
    const { payload, response } = await registerUser(app, { name, role: 'BIDDER' });
    const { token, user } = response.json();
    await prisma.walletMovement.create({
      data: {
        userId: user.id,
        type: 'DEPOSIT',
        amountCents: 500_000,
        idempotencyKey: randomUUID(),
      },
    });
    return { token, id: user.id as string, email: payload.email, name };
  }

  async function createLot(startsAt: Date, endsAt: Date, title = 'Lote do I3') {
    const lot = await prisma.lot.create({
      data: {
        auctioneerId: auctioneer.id,
        externalId: `i3-${randomUUID()}`,
        title,
        attributes: {},
        imageData: new Uint8Array(MOCK_IMAGE),
        imageContentType: 'image/png',
        startingBidCents: 10_000,
        minIncrementCents: 1_000,
        startsAt,
        originalEndsAt: endsAt,
        endsAt,
      },
    });
    return lot.id;
  }

  /** Lance pelo caso de uso com relógio injetado (para lotes já encerrados). */
  async function bidAt(lotId: string, bidderId: string, amountCents: number, now: Date) {
    await new PlaceBidUseCase(
      new PrismaBidsRepository(),
      new PrismaWalletRepository(),
      secrets,
      () => now,
    ).execute({ lotId, bidderId, amountCents, idempotencyKey: randomUUID() });
  }

  async function bidHttp(lotId: string, token: string, amountCents: number) {
    return app.inject({
      method: 'POST',
      url: `/lots/${lotId}/bids`,
      headers: { ...auth(token), 'idempotency-key': randomUUID() },
      payload: { amountCents },
    });
  }

  /** Encerrado há 1 min: Ana 10k, Bruno 11k, Ana 12k (Ana vence). Ainda não liquidado. */
  async function endedSoldLot() {
    const endsAt = new Date(Date.now() - MINUTE);
    const start = endsAt.getTime() - HOUR;
    const lotId = await createLot(new Date(start), endsAt, 'Natureza-morta do teste');
    await bidAt(lotId, ana.id, 10_000, new Date(start + MINUTE));
    await bidAt(lotId, bruno.id, 11_000, new Date(start + 2 * MINUTE));
    await bidAt(lotId, ana.id, 12_000, new Date(start + 3 * MINUTE));
    return lotId;
  }

  /** Nenhum dado pessoal (RN-15, T-09) nem segredo da cadeia. */
  function expectNoPersonalData(body: string) {
    for (const person of [ana, bruno]) {
      expect(body).not.toContain(person.id);
      expect(body).not.toContain(person.email);
      expect(body).not.toContain(person.name);
    }
    expect(body).not.toContain(auctioneer.id);
    expect(body).not.toMatch(/"(seal|headSeal|bidderId|leaderId|email|name)"/);
  }

  beforeAll(async () => {
    app = await buildApp({ itemCatalog: external.catalog });
    await app.ready();
    const a = (
      await registerUser(app, { role: 'AUCTIONEER', name: 'Leiloeira Real' })
    ).response.json();
    auctioneer = { token: a.token, id: a.user.id };
    ana = await bidder('Ana Pessoa Real');
    bruno = await bidder('Bruno Pessoa Real');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('GET /lots/:id: liquidação na leitura e viewer (RF-30)', () => {
    it('lote vencido com lances liquida na leitura: SOLD, settledAt e receiptPublicId', async () => {
      const lotId = await endedSoldLot();
      const response = await app.inject({ method: 'GET', url: `/lots/${lotId}` });
      expect(response.statusCode).toBe(200);
      const { serverTime, lot } = response.json();
      expect(Date.parse(serverTime)).not.toBeNaN();
      expect(lot).toMatchObject({
        id: lotId,
        status: 'ENDED',
        result: 'SOLD',
        currentBidCents: 12_000,
        settledAt: expect.any(String),
        receiptPublicId: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
        cancelReason: null,
        viewer: null,
      });
      expectNoPersonalData(response.body);
    });

    it('viewer: licitante logado vê o próprio pseudônimo; sem token, token inválido ou leiloeiro → null', async () => {
      const lotId = await createLot(new Date(Date.now() - MINUTE), new Date(Date.now() + HOUR));
      expect((await bidHttp(lotId, ana.token, 10_000)).statusCode).toBe(201);

      const asAna = (
        await app.inject({ method: 'GET', url: `/lots/${lotId}`, headers: auth(ana.token) })
      ).json();
      expect(asAna.lot.viewer).toEqual({
        pseudonym: expect.stringMatching(/^Licitante [0-9A-F]{6}$/),
      });
      expect(asAna.lot.viewer.pseudonym).toBe(asAna.lot.leaderPseudonym);

      const asBruno = (
        await app.inject({ method: 'GET', url: `/lots/${lotId}`, headers: auth(bruno.token) })
      ).json();
      expect(asBruno.lot.viewer.pseudonym).not.toBe(asBruno.lot.leaderPseudonym);

      for (const headers of [{}, auth('token-invalido'), auth(auctioneer.token)]) {
        const response = await app.inject({ method: 'GET', url: `/lots/${lotId}`, headers });
        expect(response.statusCode).toBe(200);
        expect(response.json().lot.viewer).toBeNull();
      }

      // Nas outras respostas, viewer é sempre null.
      const list = (await app.inject({ method: 'GET', url: '/lots' })).json();
      const listed = list.live.find((lot: { id: string }) => lot.id === lotId);
      expect(listed.viewer).toBeNull();
    });

    it('lote vencido sem lances liquida como NO_WINNER, sem comprovante', async () => {
      const lotId = await createLot(new Date(Date.now() - HOUR), new Date(Date.now() - MINUTE));
      const { lot } = (await app.inject({ method: 'GET', url: `/lots/${lotId}` })).json();
      expect(lot).toMatchObject({ status: 'ENDED', result: 'NO_WINNER', receiptPublicId: null });
    });

    it('GET /lots liquida os encerrados que mostra', async () => {
      const lotId = await endedSoldLot();
      const { ended } = (await app.inject({ method: 'GET', url: '/lots' })).json();
      expect(ended.find((lot: { id: string }) => lot.id === lotId)).toMatchObject({
        result: 'SOLD',
        receiptPublicId: expect.any(String),
      });
    });

    it('anti-sniping pela API: lance com menos de 2 min do fim prorroga o endsAt (RN-10)', async () => {
      const endsAt = new Date(Date.now() + MINUTE);
      const lotId = await createLot(new Date(Date.now() - MINUTE), endsAt);
      const response = await bidHttp(lotId, ana.token, 10_000);
      expect(response.statusCode).toBe(201);
      const { bid, lot } = response.json();
      expect(Date.parse(lot.endsAt)).toBe(Date.parse(bid.createdAt) + 2 * MINUTE);
      expect(lot.originalEndsAt).toBe(endsAt.toISOString());
    });
  });

  describe('GET /receipts/:publicId (RF-51, T-07, T-09)', () => {
    it('comprovante público, sem API externa e sem dado pessoal', async () => {
      const lotId = await endedSoldLot();
      const { lot } = (await app.inject({ method: 'GET', url: `/lots/${lotId}` })).json();
      const callsBefore = external.calls();

      const response = await app.inject({ method: 'GET', url: `/receipts/${lot.receiptPublicId}` });

      expect(response.statusCode).toBe(200);
      const stored = await prisma.lot.findUniqueOrThrow({ where: { id: lotId } });
      expect(response.json()).toEqual({
        receipt: {
          publicId: lot.receiptPublicId,
          lotId,
          title: 'Natureza-morta do teste',
          imageUrl: `/lots/${lotId}/image`,
          finalAmountCents: 12_000,
          settledAt: lot.settledAt,
          winnerPseudonym: lot.leaderPseudonym,
          finalHash: stored.headHash,
          auditPath: `/lots/${lotId}/audit`,
        },
      });
      expectNoPersonalData(response.body);

      // A imagem do comprovante também sai do banco (T-07).
      const image = await app.inject({ method: 'GET', url: `/lots/${lotId}/image` });
      expect(image.statusCode).toBe(200);
      expect(external.calls()).toBe(callsBefore);
    });

    it('inexistente, malformado ou adulterado → 404 RECEIPT_NOT_FOUND', async () => {
      for (const publicId of ['AAAAAAAAAAAAAAAAAAAAAA', 'curto', '../lots']) {
        const response = await app.inject({
          method: 'GET',
          url: `/receipts/${encodeURIComponent(publicId)}`,
        });
        expect(response.statusCode).toBe(404);
        expect(response.json().error.code).toBe('RECEIPT_NOT_FOUND');
      }

      const lotId = await endedSoldLot();
      const { lot } = (await app.inject({ method: 'GET', url: `/lots/${lotId}` })).json();
      await prisma.receipt.update({ where: { lotId }, data: { amountCents: 1 } });
      const tampered = await app.inject({ method: 'GET', url: `/receipts/${lot.receiptPublicId}` });
      expect(tampered.statusCode).toBe(404);
      expect(tampered.json().error).toEqual({
        code: 'RECEIPT_NOT_FOUND',
        message: 'Comprovante não encontrado.',
      });
    });
  });

  describe('GET /me/bids', () => {
    it('lotes com lance do licitante, mais recentes primeiro, com posição e maior lance', async () => {
      const { response } = await registerUser(app, { role: 'BIDDER', name: 'Carla Pessoa Real' });
      const carla = {
        token: response.json().token as string,
        id: response.json().user.id as string,
      };
      await prisma.walletMovement.create({
        data: {
          userId: carla.id,
          type: 'DEPOSIT',
          amountCents: 500_000,
          idempotencyKey: randomUUID(),
        },
      });

      // WON: Carla vence um lote encerrado.
      const endsAt = new Date(Date.now() - MINUTE);
      const start = endsAt.getTime() - HOUR;
      const won = await createLot(new Date(start), endsAt);
      await bidAt(won, carla.id, 10_000, new Date(start + MINUTE));
      // LOST: Carla é superada num lote encerrado.
      const lost = await createLot(new Date(start), endsAt);
      await bidAt(lost, carla.id, 10_000, new Date(start + 2 * MINUTE));
      await bidAt(lost, bruno.id, 11_000, new Date(start + 3 * MINUTE));
      // OUTBID e LEADING em lotes ao vivo (lances agora, os mais recentes).
      const outbid = await createLot(new Date(Date.now() - MINUTE), new Date(Date.now() + HOUR));
      await bidHttp(outbid, carla.token, 10_000);
      await bidHttp(outbid, bruno.token, 11_000);
      const leading = await createLot(new Date(Date.now() - MINUTE), new Date(Date.now() + HOUR));
      await bidHttp(leading, bruno.token, 10_000);
      await bidHttp(leading, carla.token, 15_000);

      const response2 = await app.inject({
        method: 'GET',
        url: '/me/bids',
        headers: auth(carla.token),
      });
      expect(response2.statusCode).toBe(200);
      const body = response2.json();
      expect(Date.parse(body.serverTime)).not.toBeNaN();
      const summary = body.items.map(
        (item: { lot: { id: string }; position: string; myMaxBidCents: number }) => [
          item.lot.id,
          item.position,
          item.myMaxBidCents,
        ],
      );
      expect(summary).toEqual([
        [leading, 'LEADING', 15_000],
        [outbid, 'OUTBID', 10_000],
        [lost, 'LOST', 10_000],
        [won, 'WON', 10_000],
      ]);
      const wonItem = body.items.find((item: { lot: { id: string } }) => item.lot.id === won);
      expect(wonItem.receiptPublicId).toEqual(expect.any(String));
      expect(wonItem.receiptPublicId).toBe(wonItem.lot.receiptPublicId);
      expect(wonItem.lot).toMatchObject({ result: 'SOLD', viewer: null });
      for (const item of body.items.filter((i: { lot: { id: string } }) => i.lot.id !== won)) {
        expect(item.receiptPublicId).toBeNull();
      }
      expect(response2.body).not.toContain(carla.id);
      expect(response2.body).not.toContain('Carla Pessoa Real');
      expectNoPersonalData(response2.body);
    });

    it('leiloeiro → 403; sem token → 401; licitante sem lances → lista vazia', async () => {
      const asAuctioneer = await app.inject({
        method: 'GET',
        url: '/me/bids',
        headers: auth(auctioneer.token),
      });
      expect(asAuctioneer.statusCode).toBe(403);
      expect((await app.inject({ method: 'GET', url: '/me/bids' })).statusCode).toBe(401);

      const { response } = await registerUser(app, { role: 'BIDDER' });
      const empty = await app.inject({
        method: 'GET',
        url: '/me/bids',
        headers: auth(response.json().token),
      });
      expect(empty.json()).toEqual({ serverTime: expect.any(String), items: [] });
    });
  });

  describe('GET /auctioneer/lots: total recebido (RF-24)', () => {
    it('soma os CREDIT de liquidação e liquida na leitura', async () => {
      const { response } = await registerUser(app, { role: 'AUCTIONEER' });
      const owner = {
        token: response.json().token as string,
        id: response.json().user.id as string,
      };
      const before = await app.inject({
        method: 'GET',
        url: '/auctioneer/lots',
        headers: auth(owner.token),
      });
      expect(before.json()).toEqual({
        serverTime: expect.any(String),
        items: [],
        totalReceivedCents: 0,
      });

      const endsAt = new Date(Date.now() - MINUTE);
      const start = endsAt.getTime() - HOUR;
      const amounts = [12_000, 30_000];
      for (const amount of amounts) {
        const lot = await prisma.lot.create({
          data: {
            auctioneerId: owner.id,
            externalId: `i3-total-${randomUUID()}`,
            title: 'Lote do total',
            attributes: {},
            imageData: new Uint8Array(MOCK_IMAGE),
            imageContentType: 'image/png',
            startingBidCents: amount,
            minIncrementCents: 1_000,
            startsAt: new Date(start),
            originalEndsAt: endsAt,
            endsAt,
          },
        });
        await bidAt(lot.id, ana.id, amount, new Date(start + MINUTE));
      }

      const after = await app.inject({
        method: 'GET',
        url: '/auctioneer/lots',
        headers: auth(owner.token),
      });
      const body = after.json();
      expect(body.totalReceivedCents).toBe(42_000);
      expect(body.items.map((lot: { result: string }) => lot.result)).toEqual(['SOLD', 'SOLD']);
    });
  });

  describe('POST /lots/:id/cancel com motivo', () => {
    const cancel = (id: string, payload?: unknown) =>
      app.inject({
        method: 'POST',
        url: `/lots/${id}/cancel`,
        headers: auth(auctioneer.token),
        ...(payload !== undefined ? { payload: payload as object } : {}),
      });

    it('sem motivo, curto ou longo demais → 422 VALIDATION_ERROR em português', async () => {
      const lotId = await createLot(new Date(Date.now() + HOUR), new Date(Date.now() + 2 * HOUR));
      const cases: [unknown, string][] = [
        [undefined, 'Envie o motivo do cancelamento no corpo: { reason }.'],
        [{}, 'Informe o motivo do cancelamento.'],
        [{ reason: '  ab  ' }, 'O motivo precisa ter pelo menos 3 caracteres.'],
        [{ reason: 'x'.repeat(281) }, 'O motivo aceita até 280 caracteres.'],
      ];
      for (const [payload, message] of cases) {
        const response = await cancel(lotId, payload);
        expect(response.statusCode).toBe(422);
        expect(response.json().error).toMatchObject({ code: 'VALIDATION_ERROR', message });
      }
      const lot = await prisma.lot.findUniqueOrThrow({ where: { id: lotId } });
      expect(lot.canceledAt).toBeNull();
    });

    it('motivo válido é gravado (sem espaços nas pontas) e aparece no lote', async () => {
      const lotId = await createLot(new Date(Date.now() + HOUR), new Date(Date.now() + 2 * HOUR));
      const response = await cancel(lotId, { reason: '  Obra retirada pelo consignante  ' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'CANCELED',
        cancelReason: 'Obra retirada pelo consignante',
      });
      const detail = (await app.inject({ method: 'GET', url: `/lots/${lotId}` })).json();
      expect(detail.lot.cancelReason).toBe('Obra retirada pelo consignante');
    });

    it('lote liquidado → 409 LOT_ENDED', async () => {
      const lotId = await createLot(new Date(Date.now() - HOUR), new Date(Date.now() - MINUTE));
      await app.inject({ method: 'GET', url: `/lots/${lotId}` });
      const response = await cancel(lotId, { reason: 'Tarde demais' });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('LOT_ENDED');
    });
  });
});
