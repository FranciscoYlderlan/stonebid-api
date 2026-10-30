import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { CancelLotUseCase } from '../../src/application/use-cases/cancel-lot.ts';
import { PlaceBidUseCase } from '../../src/application/use-cases/place-bid.ts';
import { SettleLotUseCase } from '../../src/application/use-cases/settle-lot.ts';
import { AppError } from '../../src/domain/errors/app-error.ts';
import { computeBalance } from '../../src/domain/entities/wallet.ts';
import {
  pseudonymFor,
  sameSeal,
  sealReceipt,
  verifyChain,
} from '../../src/domain/integrity/bid-chain.ts';
import { PrismaBidsRepository } from '../../src/infra/repositories/prisma/prisma-bids-repository.ts';
import { prisma } from '../../src/infra/repositories/prisma/prisma-client.ts';
import {
  PrismaLotsRepository,
  type PrismaTx,
} from '../../src/infra/repositories/prisma/prisma-lots-repository.ts';
import { PrismaSettlementRepository } from '../../src/infra/repositories/prisma/prisma-settlement-repository.ts';
import { PrismaWalletRepository } from '../../src/infra/repositories/prisma/prisma-wallet-repository.ts';
import { testEnv } from '../test-env.ts';
import { uniqueEmail } from './helpers.ts';
import { MOCK_IMAGE } from './items-api-mock.ts';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const TWO_MIN = 2 * MINUTE;
const secrets = { sealSecret: testEnv.SEAL_SECRET, pseudonymSecret: testEnv.PSEUDONYM_SECRET };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const walletRepository = new PrismaWalletRepository();
const lotsRepository = new PrismaLotsRepository();

function placeBidAt(now: Date) {
  return new PlaceBidUseCase(new PrismaBidsRepository(), walletRepository, secrets, () => now);
}

function settler(repository = new PrismaSettlementRepository(), clock?: () => Date) {
  return new SettleLotUseCase(repository, lotsRepository, secrets, clock);
}

/** Janela forçada depois de travar o lote: o disparo duplo espera na trava. */
class SlowSettlementRepository extends PrismaSettlementRepository {
  protected override async lockLot(tx: PrismaTx, lotId: string): Promise<boolean> {
    const locked = await super.lockLot(tx, lotId);
    await sleep(120);
    return locked;
  }
}

/** Sem a trava do lote: só os índices únicos seguram o disparo duplo. */
class UnlockedSettlementRepository extends SlowSettlementRepository {
  protected override async lockLot(tx: PrismaTx, lotId: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "lots" WHERE "id" = ${lotId}::uuid`;
    await sleep(120);
    return rows.length > 0;
  }
}

async function createUser(role: 'BIDDER' | 'AUCTIONEER' = 'BIDDER', depositCents = 0) {
  const user = await prisma.user.create({
    data: { name: 'Teste Liquidação', email: uniqueEmail('liq'), passwordHash: 'x', role },
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
  return user.id;
}

async function createLot(auctioneerId: string, startsAt: Date, endsAt: Date) {
  const lot = await prisma.lot.create({
    data: {
      auctioneerId,
      externalId: `liq-${randomUUID()}`,
      title: 'Lote de liquidação',
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

/** Lote encerrado há 1 min, com lances dados no passado (relógio injetado). */
async function endedLotWithBids(bids: { bidderId: string; amountCents: number }[]) {
  const auctioneerId = await createUser('AUCTIONEER');
  const endsAt = new Date(Date.now() - MINUTE);
  const lotId = await createLot(auctioneerId, new Date(endsAt.getTime() - HOUR), endsAt);
  for (const [i, bid] of bids.entries()) {
    await placeBidAt(new Date(endsAt.getTime() - HOUR + (i + 1) * MINUTE)).execute({
      lotId,
      ...bid,
      idempotencyKey: randomUUID(),
    });
  }
  return { lotId, auctioneerId, endsAt };
}

async function balance(userId: string) {
  return computeBalance(await walletRepository.totalsByType(userId));
}

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  throw new Error('esperava recusa');
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe('anti-sniping com banco (T-04, RN-10)', () => {
  async function liveLot(endsAt: Date) {
    const auctioneerId = await createUser('AUCTIONEER');
    return createLot(auctioneerId, new Date(endsAt.getTime() - HOUR), endsAt);
  }

  it('lance a exatamente 2 min do fim prorroga: fim = lance + 2 min, gravado na transação', async () => {
    const endsAt = new Date(Date.now() + HOUR);
    const lotId = await liveLot(endsAt);
    const ana = await createUser('BIDDER', 100_000);
    const now = new Date(endsAt.getTime() - TWO_MIN);

    const result = await placeBidAt(now).execute({
      lotId,
      bidderId: ana,
      amountCents: 10_000,
      idempotencyKey: randomUUID(),
    });

    expect(result.lot.endsAt.getTime()).toBe(now.getTime() + TWO_MIN);
    const stored = await prisma.lot.findUniqueOrThrow({ where: { id: lotId } });
    expect(stored.endsAt.getTime()).toBe(now.getTime() + TWO_MIN);
    expect(stored.originalEndsAt.getTime()).toBe(endsAt.getTime());
  });

  it('lance a 2 min + 1 ms do fim não prorroga', async () => {
    const endsAt = new Date(Date.now() + HOUR);
    const lotId = await liveLot(endsAt);
    const ana = await createUser('BIDDER', 100_000);

    const result = await placeBidAt(new Date(endsAt.getTime() - TWO_MIN - 1)).execute({
      lotId,
      bidderId: ana,
      amountCents: 10_000,
      idempotencyKey: randomUUID(),
    });

    expect(result.lot.endsAt.getTime()).toBe(endsAt.getTime());
    const stored = await prisma.lot.findUniqueOrThrow({ where: { id: lotId } });
    expect(stored.endsAt.getTime()).toBe(endsAt.getTime());
  });

  it('lances seguidos na janela prorrogam sem limite; no instante do fim novo → LOT_ENDED', async () => {
    const endsAt = new Date(Date.now() + HOUR);
    const lotId = await liveLot(endsAt);
    const ana = await createUser('BIDDER', 1_000_000);
    const bruno = await createUser('BIDDER', 1_000_000);

    const first = await placeBidAt(new Date(endsAt.getTime() - 1)).execute({
      lotId,
      bidderId: ana,
      amountCents: 10_000,
      idempotencyKey: randomUUID(),
    });
    const firstEnd = first.lot.endsAt.getTime();
    expect(firstEnd).toBe(endsAt.getTime() - 1 + TWO_MIN);

    const second = await placeBidAt(new Date(firstEnd - 1_000)).execute({
      lotId,
      bidderId: bruno,
      amountCents: 11_000,
      idempotencyKey: randomUUID(),
    });
    const secondEnd = second.lot.endsAt.getTime();
    expect(secondEnd).toBe(firstEnd - 1_000 + TWO_MIN);

    const late = placeBidAt(new Date(secondEnd)).execute({
      lotId,
      bidderId: ana,
      amountCents: 12_000,
      idempotencyKey: randomUUID(),
    });
    expect(await code(late)).toBe('LOT_ENDED');
    expect(await prisma.bid.count({ where: { lotId } })).toBe(2);
  });
});

describe('liquidação (T-05, RN-11, AD-08)', () => {
  it('com vencedor: RELEASE + DEBIT do vencedor, CREDIT do leiloeiro, SOLD e comprovante selado', async () => {
    const ana = await createUser('BIDDER', 100_000);
    const bruno = await createUser('BIDDER', 100_000);
    const { lotId, auctioneerId } = await endedLotWithBids([
      { bidderId: ana, amountCents: 10_000 },
      { bidderId: bruno, amountCents: 11_000 },
      { bidderId: ana, amountCents: 12_000 },
    ]);
    expect(await balance(ana)).toEqual({
      totalCents: 100_000,
      committedCents: 12_000,
      availableCents: 88_000,
    });

    const result = await settler().execute(lotId);

    expect(result?.settled).toBe(true);
    expect(result?.lot).toMatchObject({ result: 'SOLD', leaderId: ana, currentBidCents: 12_000 });
    expect(result?.lot.settledAt).toBeInstanceOf(Date);
    expect(result?.lot.receiptPublicId).toEqual(expect.any(String));

    // Vencedor paga o valor final uma vez; perdedor fica como estava (liberado quando superado).
    expect(await balance(ana)).toEqual({
      totalCents: 88_000,
      committedCents: 0,
      availableCents: 88_000,
    });
    expect(await balance(bruno)).toEqual({
      totalCents: 100_000,
      committedCents: 0,
      availableCents: 100_000,
    });
    expect(await walletRepository.sumSettlementCredits(auctioneerId)).toBe(12_000);
    const settlementMovements = await prisma.walletMovement.findMany({
      where: { lotId, type: { in: ['DEBIT', 'CREDIT'] } },
      orderBy: { seq: 'asc' },
    });
    expect(settlementMovements.map((m) => [m.type, m.userId, m.amountCents])).toEqual([
      ['DEBIT', ana, 12_000],
      ['CREDIT', auctioneerId, 12_000],
    ]);

    // Comprovante: fotografia da cabeça congelada, selo confere, sem dado pessoal.
    const lot = await prisma.lot.findUniqueOrThrow({ where: { id: lotId } });
    const receipt = await prisma.receipt.findUniqueOrThrow({ where: { lotId } });
    expect(receipt).toMatchObject({
      publicId: result?.lot.receiptPublicId,
      winnerPseudonym: pseudonymFor(secrets.pseudonymSecret, lotId, ana),
      amountCents: 12_000,
      bidCount: 3,
      finalHash: lot.headHash,
    });
    expect(receipt.settledAt.getTime()).toBe(lot.settledAt?.getTime());
    expect(sameSeal(sealReceipt(secrets.sealSecret, receipt), receipt.seal)).toBe(true);
    const bids = await prisma.bid.findMany({ where: { lotId } });
    expect(verifyChain(lotId, bids, lot, secrets)).toEqual({ ok: true, count: 3 });

    // De novo: nada muda.
    const again = await settler().execute(lotId);
    expect(again?.settled).toBe(false);
    expect(await prisma.walletMovement.count({ where: { lotId } })).toBe(
      3 /* COMMIT */ + 2 /* RELEASE por superação */ + 3 /* liquidação */,
    );
  });

  it('sem lances: NO_WINNER, sem movimento nem comprovante', async () => {
    const { lotId } = await endedLotWithBids([]);
    const result = await settler().execute(lotId);
    expect(result?.settled).toBe(true);
    expect(result?.lot).toMatchObject({ result: 'NO_WINNER', receiptPublicId: null });
    expect(await prisma.receipt.count({ where: { lotId } })).toBe(0);
    expect(await prisma.walletMovement.count({ where: { lotId } })).toBe(0);
  });

  it('disparo duplo concorrente: um só comprovante e os movimentos uma vez só', async () => {
    const ana = await createUser('BIDDER', 100_000);
    const { lotId, auctioneerId } = await endedLotWithBids([
      { bidderId: ana, amountCents: 20_000 },
    ]);

    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => settler(new SlowSettlementRepository()).execute(lotId)),
    );

    expect(outcomes.filter((o) => o?.settled)).toHaveLength(1);
    expect(new Set(outcomes.map((o) => o?.lot.receiptPublicId)).size).toBe(1);
    expect(await prisma.receipt.count({ where: { lotId } })).toBe(1);
    expect(await prisma.walletMovement.count({ where: { lotId, type: 'DEBIT' } })).toBe(1);
    expect(await prisma.walletMovement.count({ where: { lotId, type: 'CREDIT' } })).toBe(1);
    expect(await balance(ana)).toEqual({
      totalCents: 80_000,
      committedCents: 0,
      availableCents: 80_000,
    });
    expect(await walletRepository.sumSettlementCredits(auctioneerId)).toBe(20_000);
  });

  it('prova: sem a trava do lote, os índices únicos ainda deixam passar uma liquidação só', async () => {
    const ana = await createUser('BIDDER', 100_000);
    const { lotId } = await endedLotWithBids([{ bidderId: ana, amountCents: 20_000 }]);

    const outcomes = await Promise.allSettled(
      Array.from({ length: 3 }, () => settler(new UnlockedSettlementRepository()).execute(lotId)),
    );

    expect(outcomes.filter((o) => o.status === 'fulfilled' && o.value?.settled)).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === 'rejected').length).toBeGreaterThan(0);
    expect(await prisma.receipt.count({ where: { lotId } })).toBe(1);
    expect(await prisma.walletMovement.count({ where: { lotId, type: 'DEBIT' } })).toBe(1);
    expect((await balance(ana)).totalCents).toBe(80_000);
  });

  it('lote ao vivo e cancelado não liquidam; liquidado recusa lance e cancelamento (LOT_ENDED)', async () => {
    const auctioneerId = await createUser('AUCTIONEER');
    const live = await createLot(
      auctioneerId,
      new Date(Date.now() - MINUTE),
      new Date(Date.now() + HOUR),
    );
    expect((await settler().execute(live))?.settled).toBe(false);

    const canceled = await createLot(
      auctioneerId,
      new Date(Date.now() - HOUR),
      new Date(Date.now() - MINUTE),
    );
    await prisma.lot.update({
      where: { id: canceled },
      data: { canceledAt: new Date(Date.now() - 2 * MINUTE), cancelReason: 'teste' },
    });
    expect((await settler().execute(canceled))?.settled).toBe(false);
    expect(await settler().execute(randomUUID())).toBeNull();

    const ana = await createUser('BIDDER', 100_000);
    const {
      lotId,
      auctioneerId: owner,
      endsAt,
    } = await endedLotWithBids([{ bidderId: ana, amountCents: 10_000 }]);
    await settler().execute(lotId);
    const bruno = await createUser('BIDDER', 100_000);
    // Mesmo com um relógio antes do fim, o lote liquidado não volta a aceitar lance.
    const beforeEnd = new Date(endsAt.getTime() - 10 * MINUTE);
    expect(
      await code(
        placeBidAt(beforeEnd).execute({
          lotId,
          bidderId: bruno,
          amountCents: 20_000,
          idempotencyKey: randomUUID(),
        }),
      ),
    ).toBe('LOT_ENDED');
    const cancel = new CancelLotUseCase(lotsRepository, () => beforeEnd);
    expect(await code(cancel.execute({ lotId, auctioneerId: owner, reason: 'tarde demais' }))).toBe(
      'LOT_ENDED',
    );
  });

  it('agendador: settleDue liquida os vencidos até o limite', async () => {
    const first = await endedLotWithBids([]);
    const second = await endedLotWithBids([]);
    const settled = await settler().settleDue(1_000);
    const ids = settled.map((s) => s.lot.id);
    expect(ids).toEqual(expect.arrayContaining([first.lotId, second.lotId]));
    expect(await settler().settleDue(1_000)).toEqual([]);
  });
});
