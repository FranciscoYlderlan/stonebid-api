import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { CancelLotUseCase } from '../../src/application/use-cases/cancel-lot.ts';
import { PlaceBidUseCase, type PlaceBidInput } from '../../src/application/use-cases/place-bid.ts';
import { AppError } from '../../src/domain/errors/app-error.ts';
import { BidRejectedError } from '../../src/domain/errors/bid-rejected-error.ts';
import { ForbiddenError } from '../../src/domain/errors/forbidden-error.ts';
import { IdempotencyKeyReusedError } from '../../src/domain/errors/idempotency-key-reused-error.ts';
import { LotNotCancelableError } from '../../src/domain/errors/lot-not-cancelable-error.ts';
import { LotNotFoundError } from '../../src/domain/errors/lot-not-found-error.ts';
import { verifyChain } from '../../src/domain/integrity/bid-chain.ts';
import type { PlaceBidRequest } from '../../src/domain/repositories/bids-repository.ts';
import { PrismaBidsRepository } from '../../src/infra/repositories/prisma/prisma-bids-repository.ts';
import { prisma } from '../../src/infra/repositories/prisma/prisma-client.ts';
import { PrismaLotBidsReader } from '../../src/infra/repositories/prisma/prisma-lot-bids-reader.ts';
import { PrismaLotsRepository } from '../../src/infra/repositories/prisma/prisma-lots-repository.ts';
import type { PrismaTx } from '../../src/infra/repositories/prisma/prisma-lots-repository.ts';
import { PrismaWalletRepository } from '../../src/infra/repositories/prisma/prisma-wallet-repository.ts';
import { computeBalance } from '../../src/domain/entities/wallet.ts';
import { testEnv } from '../test-env.ts';
import { uniqueEmail } from './helpers.ts';
import { MOCK_IMAGE } from './items-api-mock.ts';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const secrets = { sealSecret: testEnv.SEAL_SECRET, pseudonymSecret: testEnv.PSEUDONYM_SECRET };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Janela forçada entre a leitura do estado e a gravação (o teste de corrida a usa). */
const RACE_WINDOW_MS = 150;

/** Mesmo repositório, com a janela forçada depois de ler o estado (as travas continuam). */
class SlowBidsRepository extends PrismaBidsRepository {
  protected override async readLockedState(tx: PrismaTx, request: PlaceBidRequest) {
    const state = await super.readLockedState(tx, request);
    await sleep(RACE_WINDOW_MS);
    return state;
  }
}

/** Sem a trava do lote (`FOR UPDATE` trocado por um SELECT comum), com a mesma janela. */
class UnlockedLotBidsRepository extends SlowBidsRepository {
  protected override async lockLot(tx: PrismaTx, lotId: string): Promise<boolean> {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT "id" FROM "lots" WHERE "id" = ${lotId}::uuid`;
    return rows.length > 0;
  }
}

/** Sem a trava da carteira do licitante, com a mesma janela. */
class UnlockedWalletBidsRepository extends SlowBidsRepository {
  protected override async lockBidderWallet(tx: PrismaTx, bidderId: string) {
    const rows = await tx.$queryRaw<{ role: 'BIDDER' | 'AUCTIONEER' }[]>`
      SELECT "role"::text AS "role" FROM "users" WHERE "id" = ${bidderId}::uuid`;
    return rows[0]?.role ?? null;
  }
}

const walletRepository = new PrismaWalletRepository();

function placeBid(repository = new PrismaBidsRepository()) {
  return new PlaceBidUseCase(repository, walletRepository, secrets);
}

async function createUser(role: 'BIDDER' | 'AUCTIONEER' = 'BIDDER', depositCents = 0) {
  const user = await prisma.user.create({
    data: { name: 'Teste', email: uniqueEmail('lance'), passwordHash: 'x', role },
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

let auctioneerId: string | undefined;

async function createLot(
  overrides: Partial<{
    startsAt: Date;
    endsAt: Date;
    startingBidCents: number;
    minIncrementCents: number;
  }> = {},
) {
  auctioneerId ??= await createUser('AUCTIONEER');
  const lot = await prisma.lot.create({
    data: {
      auctioneerId,
      // Obra própria: os ids genéricos da API simulada se repetem entre arquivos de teste.
      externalId: `lance-${randomUUID()}`,
      title: 'Lote de lances',
      attributes: {},
      imageData: new Uint8Array(MOCK_IMAGE),
      imageContentType: 'image/png',
      startingBidCents: overrides.startingBidCents ?? 10_000,
      minIncrementCents: overrides.minIncrementCents ?? 500,
      startsAt: overrides.startsAt ?? new Date(Date.now() - MINUTE),
      originalEndsAt: overrides.endsAt ?? new Date(Date.now() + HOUR),
      endsAt: overrides.endsAt ?? new Date(Date.now() + HOUR),
    },
  });
  return lot.id;
}

async function wallet(userId: string) {
  return computeBalance(await walletRepository.totalsByType(userId));
}

function bid(
  lotId: string,
  bidderId: string,
  amountCents: number,
  idempotencyKey = randomUUID(),
): PlaceBidInput {
  return { lotId, bidderId, amountCents, idempotencyKey };
}

async function rejectionCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  throw new Error('esperava recusa');
}

/** Invariantes do RNF-04 e da cadeia, lidos do banco. */
async function expectLotInvariants(lotId: string) {
  const lot = await prisma.lot.findUniqueOrThrow({ where: { id: lotId } });
  const bids = await prisma.bid.findMany({ where: { lotId }, orderBy: { seq: 'asc' } });

  // seq 1..n sem buraco, cabeça igual ao último, lance atual e líder iguais ao último lance.
  expect(bids.map((b) => b.seq)).toEqual(bids.map((_, i) => i + 1));
  expect(lot.headSeq).toBe(bids.length);
  const last = bids.at(-1);
  expect(lot.currentBidCents).toBe(last?.amountCents ?? null);
  expect(lot.leaderId).toBe(last?.bidderId ?? null);
  // Cada lance cobre o anterior pelo menos pelo incremento.
  for (let i = 1; i < bids.length; i++) {
    expect(bids[i]!.amountCents).toBeGreaterThanOrEqual(
      bids[i - 1]!.amountCents + lot.minIncrementCents,
    );
    expect(bids[i]!.bidderId).not.toBe(bids[i - 1]!.bidderId);
  }

  // Comprometido no lote = só o lance do líder atual.
  const movements = await prisma.walletMovement.findMany({ where: { lotId } });
  const committedByUser = new Map<string, number>();
  for (const m of movements) {
    const delta = m.type === 'COMMIT' ? m.amountCents : m.type === 'RELEASE' ? -m.amountCents : 0;
    committedByUser.set(m.userId, (committedByUser.get(m.userId) ?? 0) + delta);
  }
  for (const [userId, committed] of committedByUser) {
    expect(committed).toBe(userId === lot.leaderId ? lot.currentBidCents : 0);
  }

  expect(verifyChain(lotId, bids, lot, secrets)).toEqual({ ok: true, count: bids.length });
  return { lot, bids };
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe('núcleo do lance (RF-33, RN-02 a RN-09)', () => {
  it('lance válido: grava seq 1, compromete o valor, atualiza lance atual, líder e cabeça', async () => {
    const lotId = await createLot();
    const ana = await createUser('BIDDER', 100_000);

    const result = await placeBid().execute(bid(lotId, ana, 10_000));

    expect(result.created).toBe(true);
    expect(result.bid).toEqual({
      seq: 1,
      lotId,
      amountCents: 10_000,
      pseudonym: expect.stringMatching(/^Licitante [0-9A-F]{6}$/),
      createdAt: expect.any(Date),
    });
    expect(result.lot).toMatchObject({ currentBidCents: 10_000, leaderId: ana, headSeq: 1 });
    expect(result.wallet).toEqual({
      totalCents: 100_000,
      committedCents: 10_000,
      availableCents: 90_000,
    });
    await expectLotInvariants(lotId);
  });

  it('T-01 com banco: mínimo, líder, lote inexistente e leiloeiro', async () => {
    const lotId = await createLot();
    const ana = await createUser('BIDDER', 100_000);
    const bruno = await createUser('BIDDER', 100_000);

    expect(await rejectionCode(placeBid().execute(bid(lotId, ana, 9_999)))).toBe(
      'BID_BELOW_MINIMUM',
    );
    await placeBid().execute(bid(lotId, ana, 10_000));
    expect(await rejectionCode(placeBid().execute(bid(lotId, ana, 20_000)))).toBe(
      'ALREADY_WINNING',
    );
    const below = placeBid().execute(bid(lotId, bruno, 10_499));
    await expect(below).rejects.toBeInstanceOf(BidRejectedError);
    await expect(below).rejects.toMatchObject({ details: { minAmountCents: 10_500 } });
    await placeBid().execute(bid(lotId, bruno, 10_500));

    await expect(placeBid().execute(bid(randomUUID(), ana, 10_000))).rejects.toBeInstanceOf(
      LotNotFoundError,
    );
    await expect(placeBid().execute(bid('nao-e-uuid', ana, 10_000))).rejects.toBeInstanceOf(
      LotNotFoundError,
    );

    const leiloeiro = await createUser('AUCTIONEER');
    await expect(placeBid().execute(bid(lotId, leiloeiro, 50_000))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expectLotInvariants(lotId);
  });

  it('T-01: lote agendado, encerrado, no instante do fim e cancelado recusam', async () => {
    const ana = await createUser('BIDDER', 100_000);
    const scheduled = await createLot({
      startsAt: new Date(Date.now() + HOUR),
      endsAt: new Date(Date.now() + 2 * HOUR),
    });
    expect(await rejectionCode(placeBid().execute(bid(scheduled, ana, 10_000)))).toBe(
      'LOT_NOT_STARTED',
    );

    const ended = await createLot({
      startsAt: new Date(Date.now() - 2 * HOUR),
      endsAt: new Date(Date.now() - MINUTE),
    });
    expect(await rejectionCode(placeBid().execute(bid(ended, ana, 10_000)))).toBe('LOT_ENDED');

    const endsAt = new Date(Date.now() + HOUR);
    const atEnd = await createLot({ endsAt });
    const atEndUseCase = new PlaceBidUseCase(
      new PrismaBidsRepository(),
      walletRepository,
      secrets,
      () => endsAt,
    );
    expect(await rejectionCode(atEndUseCase.execute(bid(atEnd, ana, 10_000)))).toBe('LOT_ENDED');

    const canceled = await createLot();
    await prisma.lot.update({ where: { id: canceled }, data: { canceledAt: new Date() } });
    expect(await rejectionCode(placeBid().execute(bid(canceled, ana, 10_000)))).toBe(
      'LOT_CANCELED',
    );

    expect(
      await prisma.bid.count({ where: { lotId: { in: [scheduled, ended, atEnd, canceled] } } }),
    ).toBe(0);
    expect(await wallet(ana)).toEqual({
      totalCents: 100_000,
      committedCents: 0,
      availableCents: 100_000,
    });
  });

  it('T-03: exemplo da Ana (5.3), passos 1 a 5', async () => {
    const ana = await createUser('BIDDER', 100_000); // 1. deposita R$ 1.000
    const bruno = await createUser('BIDDER', 100_000);
    const opts = { startingBidCents: 100, minIncrementCents: 100 };
    const [a, b, c] = [await createLot(opts), await createLot(opts), await createLot(opts)];

    await placeBid().execute(bid(a, ana, 30_000)); // 2. lidera A com R$ 300
    expect(await wallet(ana)).toEqual({
      totalCents: 100_000,
      committedCents: 30_000,
      availableCents: 70_000,
    });

    await placeBid().execute(bid(b, ana, 50_000)); // 3. lidera B com R$ 500
    expect(await wallet(ana)).toEqual({
      totalCents: 100_000,
      committedCents: 80_000,
      availableCents: 20_000,
    });

    // 4. R$ 300 no lote C: recusado, só há R$ 200 disponíveis.
    const refused = placeBid().execute(bid(c, ana, 30_000));
    await expect(refused).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      message: 'Saldo insuficiente: você tem R$ 200,00 disponíveis para lances.',
      details: { availableCents: 20_000 },
    });
    expect(await wallet(ana)).toEqual({
      totalCents: 100_000,
      committedCents: 80_000,
      availableCents: 20_000,
    });

    // 5. Bruno cobre Ana no lote A com R$ 350: os R$ 300 dela voltam na hora.
    const covered = await placeBid().execute(bid(a, bruno, 35_000));
    expect(covered.wallet).toEqual({
      totalCents: 100_000,
      committedCents: 35_000,
      availableCents: 65_000,
    });
    expect(await wallet(ana)).toEqual({
      totalCents: 100_000,
      committedCents: 50_000,
      availableCents: 50_000,
    });

    // Extrato pela sequência global: o RELEASE da Ana veio depois do COMMIT do Bruno.
    const [release] = await walletRepository.listByUser(ana);
    expect(release).toMatchObject({ type: 'RELEASE', amountCents: 30_000, lotId: a });
    const [commit] = await walletRepository.listByUser(bruno);
    expect(commit).toMatchObject({ type: 'COMMIT', amountCents: 35_000, lotId: a });
    expect(release!.seq).toBeGreaterThan(commit!.seq);

    await expectLotInvariants(a);
    await expectLotInvariants(b);
  });

  it('T-11: mesma chave = um lance só (repetida e em paralelo); chave com outro valor → 409', async () => {
    const lotId = await createLot();
    const ana = await createUser('BIDDER', 100_000);
    const key = randomUUID();

    const first = await placeBid().execute(bid(lotId, ana, 10_000, key));
    const again = await placeBid().execute(bid(lotId, ana, 10_000, key));
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.bid).toEqual(first.bid);
    expect(await wallet(ana)).toMatchObject({ committedCents: 10_000 });

    await expect(placeBid().execute(bid(lotId, ana, 11_000, key))).rejects.toBeInstanceOf(
      IdempotencyKeyReusedError,
    );
    const otherLot = await createLot();
    await expect(placeBid().execute(bid(otherLot, ana, 10_000, key))).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
      message:
        'Esta Idempotency-Key já foi usada em outro lance. Gere uma chave nova para um lance novo.',
    });

    // Duplo clique: 5 pedidos iguais ao mesmo tempo → 1 lance gravado.
    const bruno = await createUser('BIDDER', 100_000);
    const parallelKey = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => placeBid().execute(bid(lotId, bruno, 10_500, parallelKey))),
    );
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.bid.seq))).toEqual(new Set([2]));
    expect(await prisma.bid.count({ where: { lotId } })).toBe(2);
    expect(await wallet(bruno)).toMatchObject({ committedCents: 10_500 });
    await expectLotInvariants(lotId);
  });
});

describe('concorrência (T-02, RN-09, RNF-04)', () => {
  const N = 12;

  /** N licitantes dão lances ao mesmo tempo no mesmo lote, com valores que se cruzam. */
  async function race(repository: PrismaBidsRepository) {
    const lotId = await createLot({ startingBidCents: 1_000, minIncrementCents: 100 });
    const bidders = await Promise.all(
      Array.from({ length: N }, () => createUser('BIDDER', 1_000_000)),
    );
    const outcomes = await Promise.allSettled(
      bidders.map((bidderId, i) =>
        placeBid(repository).execute(bid(lotId, bidderId, 1_000 + (i % 4) * 100)),
      ),
    );
    return { lotId, bidders, outcomes };
  }

  it('com as travas: cada pedido é aceito ou recusado por regra; seq 1..n; saldos e cadeia certos', async () => {
    const { lotId, bidders, outcomes } = await race(new SlowBidsRepository());

    const unexpected = outcomes.filter(
      (o) => o.status === 'rejected' && !(o.reason instanceof BidRejectedError),
    );
    expect(unexpected).toEqual([]);
    const accepted = outcomes.filter((o) => o.status === 'fulfilled');
    expect(accepted.length).toBeGreaterThanOrEqual(1);

    const { lot, bids } = await expectLotInvariants(lotId);
    expect(bids).toHaveLength(accepted.length);

    // Disponível ≥ 0 para todos; comprometido = soma das lideranças (só o líder tem valor preso).
    let committedSum = 0;
    for (const bidderId of bidders) {
      const balance = await wallet(bidderId);
      expect(balance.availableCents).toBeGreaterThanOrEqual(0);
      committedSum += balance.committedCents;
    }
    expect(committedSum).toBe(lot.currentBidCents);
  });

  it('prova: sem a trava do lote, a mesma corrida quebra (seq repetido vira erro fora das regras)', async () => {
    const { outcomes } = await race(new UnlockedLotBidsRepository());
    const unexpected = outcomes.filter(
      (o) => o.status === 'rejected' && !(o.reason instanceof BidRejectedError),
    );
    expect(unexpected.length).toBeGreaterThan(0);
  });

  /** Um licitante, saldo para um lance só, lances ao mesmo tempo em N lotes diferentes. */
  async function overdraft(repository: PrismaBidsRepository) {
    const ana = await createUser('BIDDER', 10_000);
    const lots = await Promise.all(
      Array.from({ length: 6 }, () => createLot({ startingBidCents: 10_000 })),
    );
    const outcomes = await Promise.allSettled(
      lots.map((lotId) => placeBid(repository).execute(bid(lotId, ana, 10_000))),
    );
    return { ana, outcomes };
  }

  it('com a trava da carteira: lances do mesmo licitante em lotes diferentes não estouram o saldo', async () => {
    const { ana, outcomes } = await overdraft(new SlowBidsRepository());
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    for (const o of outcomes) {
      if (o.status === 'rejected') expect(o.reason).toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    }
    expect(await wallet(ana)).toEqual({
      totalCents: 10_000,
      committedCents: 10_000,
      availableCents: 0,
    });
  });

  it('prova: sem a trava da carteira, o disponível fica negativo', async () => {
    const { ana, outcomes } = await overdraft(new UnlockedWalletBidsRepository());
    expect(outcomes.filter((o) => o.status === 'fulfilled').length).toBeGreaterThan(1);
    expect((await wallet(ana)).availableCents).toBeLessThan(0);
  });

  it('lances cruzados (A cobre B num lote e B cobre A em outro, ao mesmo tempo) não travam', async () => {
    const ana = await createUser('BIDDER', 1_000_000);
    const bruno = await createUser('BIDDER', 1_000_000);
    for (let round = 0; round < 5; round++) {
      const [x, y] = [await createLot(), await createLot()];
      await placeBid().execute(bid(x, bruno, 10_000));
      await placeBid().execute(bid(y, ana, 10_000));
      await Promise.all([
        placeBid(new SlowBidsRepository()).execute(bid(x, ana, 11_000)),
        placeBid(new SlowBidsRepository()).execute(bid(y, bruno, 11_000)),
      ]);
      await expectLotInvariants(x);
      await expectLotInvariants(y);
    }
  });
});

describe('cancelamento × lance (T-10a, M-13)', () => {
  const lotsRepository = new PrismaLotsRepository();
  const cancelLot = () => new CancelLotUseCase(lotsRepository);

  it('lote ao vivo com lance: cancelamento recusado com o motivo', async () => {
    const lotId = await createLot();
    const ana = await createUser('BIDDER', 100_000);
    await placeBid().execute(bid(lotId, ana, 10_000));
    await expect(
      cancelLot().execute({ lotId, auctioneerId: auctioneerId!, reason: 'Motivo de teste' }),
    ).rejects.toMatchObject({
      code: 'LOT_NOT_CANCELABLE',
      message: 'O lote já tem lances e não pode ser cancelado.',
    });
    expect(await new PrismaLotBidsReader().hasBids(lotId)).toBe(true);
  });

  it('cancelamento e lance ao mesmo tempo: só um passa', async () => {
    const ana = await createUser('BIDDER', 1_000_000);
    for (let round = 0; round < 6; round++) {
      const lotId = await createLot();
      const [bidOutcome, cancelOutcome] = await Promise.allSettled([
        placeBid(new SlowBidsRepository()).execute(bid(lotId, ana, 10_000)),
        cancelLot().execute({ lotId, auctioneerId: auctioneerId!, reason: 'Motivo de teste' }),
      ]);
      const lot = await prisma.lot.findUniqueOrThrow({ where: { id: lotId } });
      if (bidOutcome.status === 'fulfilled') {
        expect(cancelOutcome.status).toBe('rejected');
        if (cancelOutcome.status === 'rejected')
          expect(cancelOutcome.reason).toBeInstanceOf(LotNotCancelableError);
        expect(lot.canceledAt).toBeNull();
        expect(lot.headSeq).toBe(1);
      } else {
        expect(bidOutcome.reason).toMatchObject({ code: 'LOT_CANCELED' });
        expect(cancelOutcome.status).toBe('fulfilled');
        expect(lot.canceledAt).not.toBeNull();
        expect(lot.headSeq).toBe(0);
      }
    }
    // Sem lance preso: o comprometido da Ana é a soma dos lotes que ela lidera.
    const leading = await prisma.lot.aggregate({
      where: { leaderId: ana },
      _sum: { currentBidCents: true },
    });
    expect((await wallet(ana)).committedCents).toBe(leading._sum.currentBidCents ?? 0);
  });

  it('o cancelamento lê o lance gravado enquanto esperava a trava', async () => {
    const lotId = await createLot();
    const ana = await createUser('BIDDER', 100_000);
    // O lance segura a trava pela janela; o cancelamento chega depois e espera.
    const pending = placeBid(new SlowBidsRepository()).execute(bid(lotId, ana, 10_000));
    await sleep(RACE_WINDOW_MS / 3);
    const cancel = cancelLot().execute({
      lotId,
      auctioneerId: auctioneerId!,
      reason: 'Motivo de teste',
    });
    const [bidOutcome, cancelOutcome] = await Promise.allSettled([pending, cancel]);
    expect(bidOutcome).toMatchObject({ status: 'fulfilled', value: { created: true } });
    expect(cancelOutcome).toMatchObject({
      status: 'rejected',
      reason: { message: 'O lote já tem lances e não pode ser cancelado.' },
    });
  });
});
