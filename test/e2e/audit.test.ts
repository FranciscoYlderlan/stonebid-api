import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { PlaceBidUseCase } from '../../src/application/use-cases/place-bid.ts';
import { computeBidHash, pseudonymFor, sealBid } from '../../src/domain/integrity/bid-chain.ts';
import { PrismaBidsRepository } from '../../src/infra/repositories/prisma/prisma-bids-repository.ts';
import { prisma } from '../../src/infra/repositories/prisma/prisma-client.ts';
import { PrismaWalletRepository } from '../../src/infra/repositories/prisma/prisma-wallet-repository.ts';
import { testEnv } from '../test-env.ts';
import { registerUser, uniqueEmail } from './helpers.ts';
import { MOCK_IMAGE } from './items-api-mock.ts';

/**
 * T-06 (RF-60, RF-61): auditoria pública recalculada a cada acesso. A adulteração é feita por SQL
 * direto no banco, sem passar pela aplicação, com o lote ao vivo e depois da liquidação.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const secrets = { sealSecret: testEnv.SEAL_SECRET, pseudonymSecret: testEnv.PSEUDONYM_SECRET };
const walletRepository = new PrismaWalletRepository();

interface AuditBody {
  lot: { id: string; status: string; result: string | null; viewer: unknown };
  bids: { seq: number; pseudonym: string; amountCents: number }[];
  verdict: 'INTACT' | 'TAMPERED';
  firstInconsistency: { seq: number | null; reason: string } | null;
  checkedAt: string;
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function createUser(role: 'BIDDER' | 'AUCTIONEER', depositCents = 0) {
  const user = await prisma.user.create({
    data: {
      name: `Pessoa Auditoria ${role}`,
      email: uniqueEmail('audit'),
      passwordHash: 'x',
      role,
    },
  });
  if (depositCents > 0) {
    await prisma.walletMovement.create({
      data: {
        userId: user.id,
        type: 'DEPOSIT',
        amountCents: depositCents,
        idempotencyKey: randomUUID(),
      },
    });
  }
  return user;
}

/** Lote com 3 lances (Ana, Bruno, Ana). `ended`: encerrado há 1 min, liquidado na leitura. */
async function lotWithThreeBids(ended: boolean) {
  const auctioneer = await createUser('AUCTIONEER');
  const ana = await createUser('BIDDER', 1_000_000);
  const bruno = await createUser('BIDDER', 1_000_000);
  const endsAt = ended ? new Date(Date.now() - MINUTE) : new Date(Date.now() + HOUR);
  const startsAt = new Date(Date.now() - 2 * HOUR);
  const lot = await prisma.lot.create({
    data: {
      auctioneerId: auctioneer.id,
      externalId: `audit-${randomUUID()}`,
      title: 'Lote da auditoria',
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
  const bidders = [ana, bruno, ana];
  for (const [i, bidder] of bidders.entries()) {
    const at = new Date(startsAt.getTime() + (i + 1) * MINUTE);
    await new PlaceBidUseCase(
      new PrismaBidsRepository(),
      walletRepository,
      secrets,
      () => at,
    ).execute({
      lotId: lot.id,
      bidderId: bidder.id,
      amountCents: 10_000 + i * 1_000,
      idempotencyKey: randomUUID(),
    });
  }
  return { lotId: lot.id, users: [auctioneer, ana, bruno] };
}

async function audit(lotId: string, headers: Record<string, string> = {}) {
  const response = await app.inject({ method: 'GET', url: `/lots/${lotId}/audit`, headers });
  return { response, body: response.json() as AuditBody };
}

/** Prepara o lote no estado do cenário: ao vivo, ou já liquidado e íntegro antes da adulteração. */
async function prepared(stage: 'live' | 'settled') {
  const created = await lotWithThreeBids(stage === 'settled');
  const before = await audit(created.lotId);
  expect(before.body.verdict).toBe('INTACT');
  if (stage === 'settled') {
    expect(before.body.lot).toMatchObject({ status: 'ENDED', result: 'SOLD' });
  } else {
    expect(before.body.lot).toMatchObject({ status: 'LIVE', result: null });
  }
  return created;
}

const tamperings: Array<{
  name: string;
  tamper: (lotId: string) => Promise<unknown>;
  expected: AuditBody['firstInconsistency'];
}> = [
  {
    name: 'íntegro',
    tamper: async () => undefined,
    expected: null,
  },
  {
    name: 'valor editado',
    tamper: (lotId) =>
      prisma.$executeRaw`UPDATE "bids" SET "amount_cents" = "amount_cents" + 500
        WHERE "lot_id" = ${lotId}::uuid AND "seq" = 2`,
    expected: { seq: 2, reason: 'CONTENT_CHANGED' },
  },
  {
    name: 'lance apagado no meio',
    tamper: (lotId) =>
      prisma.$executeRaw`DELETE FROM "bids" WHERE "lot_id" = ${lotId}::uuid AND "seq" = 2`,
    expected: { seq: 2, reason: 'GAP' },
  },
  {
    name: 'lance inserido',
    tamper: async (lotId) => {
      // Abre espaço no seq 2 (em duas passadas, por causa do índice único) e insere um lance
      // forjado ligado ao lance 1, sem o segredo do selo.
      await prisma.$executeRaw`UPDATE "bids" SET "seq" = "seq" + 1000
        WHERE "lot_id" = ${lotId}::uuid AND "seq" >= 2`;
      await prisma.$executeRaw`UPDATE "bids" SET "seq" = "seq" - 999
        WHERE "lot_id" = ${lotId}::uuid AND "seq" >= 1000`;
      await prisma.$executeRaw`
        INSERT INTO "bids" ("id", "lot_id", "seq", "bidder_id", "amount_cents", "idempotency_key",
          "created_at", "prev_hash", "hash", "seal")
        SELECT gen_random_uuid(), "lot_id", 2, "bidder_id", 10500, ${randomUUID()},
          "created_at" + interval '1 second', "hash", md5(random()::text), md5(random()::text)
        FROM "bids" WHERE "lot_id" = ${lotId}::uuid AND "seq" = 1`;
    },
    expected: { seq: 2, reason: 'CONTENT_CHANGED' },
  },
  {
    name: 'último lance apagado',
    tamper: (lotId) =>
      prisma.$executeRaw`DELETE FROM "bids" WHERE "lot_id" = ${lotId}::uuid AND "seq" = 3`,
    expected: { seq: null, reason: 'HEAD_MISMATCH' },
  },
  {
    name: 'selo do lance trocado',
    tamper: (lotId) =>
      prisma.$executeRaw`UPDATE "bids" SET "seal" = md5(random()::text)
        WHERE "lot_id" = ${lotId}::uuid AND "seq" = 2`,
    expected: { seq: 2, reason: 'BAD_SEAL' },
  },
  {
    name: 'ligação quebrada',
    tamper: async (lotId) => {
      // O lance 2 é refeito por inteiro (hash e selo válidos, como de um backup de outro
      // histórico), mas ligado a um hash que não é o do lance 1.
      const bid = await prisma.bid.findFirstOrThrow({ where: { lotId, seq: 2 } });
      const prevHash = 'f'.repeat(64);
      const hash = computeBidHash({
        lotId,
        seq: 2,
        pseudonym: pseudonymFor(secrets.pseudonymSecret, lotId, bid.bidderId),
        amountCents: bid.amountCents,
        createdAt: bid.createdAt,
        prevHash,
      });
      await prisma.$executeRaw`UPDATE "bids" SET "prev_hash" = ${prevHash}, "hash" = ${hash},
        "seal" = ${sealBid(secrets.sealSecret, hash)}
        WHERE "lot_id" = ${lotId}::uuid AND "seq" = 2`;
    },
    expected: { seq: 2, reason: 'BROKEN_LINK' },
  },
  {
    name: 'lance atual adulterado',
    tamper: (lotId) =>
      prisma.$executeRaw`UPDATE "lots" SET "current_bid_cents" = "current_bid_cents" - 100
        WHERE "id" = ${lotId}::uuid`,
    expected: { seq: null, reason: 'HEAD_MISMATCH' },
  },
  {
    name: 'líder adulterado',
    tamper: (lotId) =>
      prisma.$executeRaw`UPDATE "lots" SET "leader_id" = (SELECT "bidder_id" FROM "bids"
        WHERE "lot_id" = ${lotId}::uuid AND "seq" = 2) WHERE "id" = ${lotId}::uuid`,
    expected: { seq: null, reason: 'HEAD_MISMATCH' },
  },
];

describe.each(['live', 'settled'] as const)('auditoria com o lote %s (T-06)', (stage) => {
  it.each(tamperings)('$name', async ({ tamper, expected }) => {
    const { lotId } = await prepared(stage);
    await tamper(lotId);

    const { response, body } = await audit(lotId);
    expect(response.statusCode).toBe(200);
    expect(body.verdict).toBe(expected ? 'TAMPERED' : 'INTACT');
    expect(body.firstInconsistency).toEqual(expected);
    // Recalculado a cada acesso: a segunda leitura chega ao mesmo veredito.
    expect((await audit(lotId)).body.firstInconsistency).toEqual(expected);
  });
});

describe('auditoria depois da liquidação: comprovante e extrato (T-06)', () => {
  it('comprovante adulterado → RECEIPT_MISMATCH sem seq', async () => {
    const { lotId } = await prepared('settled');
    await prisma.$executeRaw`UPDATE "receipts" SET "amount_cents" = "amount_cents" - 100
      WHERE "lot_id" = ${lotId}::uuid`;

    const { body } = await audit(lotId);
    expect(body.verdict).toBe('TAMPERED');
    expect(body.firstInconsistency).toEqual({ seq: null, reason: 'RECEIPT_MISMATCH' });
  });

  it('DEBIT do vencedor adulterado no extrato → SETTLEMENT_MISMATCH sem seq', async () => {
    const { lotId } = await prepared('settled');
    await prisma.$executeRaw`UPDATE "wallet_movements" SET "amount_cents" = "amount_cents" - 100
      WHERE "lot_id" = ${lotId}::uuid AND "type" = 'DEBIT'`;

    const { body } = await audit(lotId);
    expect(body.firstInconsistency).toEqual({ seq: null, reason: 'SETTLEMENT_MISMATCH' });
  });

  it.each([
    {
      name: 'adulterado',
      tamper: (lotId: string) =>
        prisma.$executeRaw`UPDATE "wallet_movements" SET "amount_cents" = "amount_cents" - 100
          WHERE "lot_id" = ${lotId}::uuid AND "type" = 'CREDIT'`,
    },
    {
      name: 'apagado',
      tamper: (lotId: string) =>
        prisma.$executeRaw`DELETE FROM "wallet_movements"
          WHERE "lot_id" = ${lotId}::uuid AND "type" = 'CREDIT'`,
    },
  ])('CREDIT do leiloeiro $name no extrato → SETTLEMENT_MISMATCH', async ({ tamper }) => {
    const { lotId } = await prepared('settled');
    await tamper(lotId);

    const { body } = await audit(lotId);
    expect(body.verdict).toBe('TAMPERED');
    expect(body.firstInconsistency).toEqual({ seq: null, reason: 'SETTLEMENT_MISMATCH' });
  });

  it('resultado trocado para NO_WINNER, sem comprovante, DEBIT nem CREDIT → SETTLEMENT_MISMATCH', async () => {
    // Sem o SEAL_SECRET: apaga o que o comprovante e o extrato provariam e declara "sem vencedor".
    const { lotId } = await prepared('settled');
    await prisma.$executeRaw`DELETE FROM "receipts" WHERE "lot_id" = ${lotId}::uuid`;
    await prisma.$executeRaw`DELETE FROM "wallet_movements"
      WHERE "lot_id" = ${lotId}::uuid AND "type" IN ('DEBIT', 'CREDIT')`;
    await prisma.$executeRaw`UPDATE "lots" SET "result" = 'NO_WINNER' WHERE "id" = ${lotId}::uuid`;

    const { body } = await audit(lotId);
    expect(body.lot.result).toBe('NO_WINNER');
    expect(body.verdict).toBe('TAMPERED');
    expect(body.firstInconsistency).toEqual({ seq: null, reason: 'SETTLEMENT_MISMATCH' });
  });

  it('a cadeia vem antes do comprovante: lance editado e comprovante editado → CONTENT_CHANGED', async () => {
    const { lotId } = await prepared('settled');
    await prisma.$executeRaw`UPDATE "receipts" SET "amount_cents" = "amount_cents" - 100
      WHERE "lot_id" = ${lotId}::uuid`;
    await prisma.$executeRaw`UPDATE "bids" SET "amount_cents" = "amount_cents" + 1
      WHERE "lot_id" = ${lotId}::uuid AND "seq" = 1`;

    const { body } = await audit(lotId);
    expect(body.firstInconsistency).toEqual({ seq: 1, reason: 'CONTENT_CHANGED' });
  });
});

describe('GET /lots/:id/audit: contrato público (RF-60, RN-15, T-09)', () => {
  it('sem dado pessoal, com no-store, lances em ordem de seq e JWT ignorado', async () => {
    const { lotId, users } = await prepared('settled');
    const bidder = await registerUser(app);
    const token = (bidder.response.json() as { token: string }).token;

    const { response, body } = await audit(lotId, { authorization: `Bearer ${token}` });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(body.lot.viewer).toBeNull();
    expect(body.bids.map((bid) => bid.seq)).toEqual([1, 2, 3]);
    expect(body.bids.map((bid) => bid.amountCents)).toEqual([10_000, 11_000, 12_000]);
    expect(body.bids[0]?.pseudonym).toMatch(/^Licitante [0-9A-F]{6}$/);
    expect(body.bids[0]?.pseudonym).toBe(body.bids[2]?.pseudonym);
    expect(Object.keys(body.bids[0] ?? {}).sort()).toEqual([
      'amountCents',
      'createdAt',
      'hash',
      'prevHash',
      'pseudonym',
      'seq',
    ]);

    const raw = response.body;
    for (const user of users) {
      expect(raw).not.toContain(user.id);
      expect(raw).not.toContain(user.email);
      expect(raw).not.toContain(user.name);
    }
    expect(raw).not.toMatch(/"(seal|headSeal|bidderId|leaderId|auctioneerId|email|name)"/);
    const stored = await prisma.bid.findMany({ where: { lotId } });
    for (const bid of stored) expect(raw).not.toContain(bid.seal);
    expect(Date.parse(body.checkedAt)).not.toBeNaN();

    // Token inválido também é ignorado (nunca 401).
    expect((await audit(lotId, { authorization: 'Bearer lixo' })).response.statusCode).toBe(200);
  });

  it('lote cancelado sem lances também é auditável', async () => {
    const auctioneer = await createUser('AUCTIONEER');
    const lot = await prisma.lot.create({
      data: {
        auctioneerId: auctioneer.id,
        externalId: `audit-cancel-${randomUUID()}`,
        title: 'Lote cancelado',
        attributes: {},
        imageData: new Uint8Array(MOCK_IMAGE),
        imageContentType: 'image/png',
        startingBidCents: 1_000,
        minIncrementCents: 100,
        startsAt: new Date(Date.now() + HOUR),
        originalEndsAt: new Date(Date.now() + 2 * HOUR),
        endsAt: new Date(Date.now() + 2 * HOUR),
        canceledAt: new Date(),
        cancelReason: 'Obra retirada',
      },
    });
    const { response, body } = await audit(lot.id);
    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      lot: { status: 'CANCELED' },
      bids: [],
      verdict: 'INTACT',
      firstInconsistency: null,
    });
  });

  it('id inválido ou inexistente → 404 LOT_NOT_FOUND, como GET /lots/:id', async () => {
    for (const id of ['nao-e-uuid', randomUUID()]) {
      const response = await app.inject({ method: 'GET', url: `/lots/${id}/audit` });
      const lot = await app.inject({ method: 'GET', url: `/lots/${id}` });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: { code: 'LOT_NOT_FOUND' } });
      expect(lot.statusCode).toBe(404);
    }
  });
});
