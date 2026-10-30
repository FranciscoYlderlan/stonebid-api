import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { prisma } from '../../src/infra/repositories/prisma/prisma-client.ts';
import { testEnv } from '../test-env.ts';
import { registerUser } from './helpers.ts';

const LIMIT_CENTS = 1_000_000;

describe('carteira (RF-40 a RF-42, RN-07, RN-16, RN-18, Q-10)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ mcpEnabled: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function newBidder(): Promise<{ token: string; userId: string }> {
    const body = (await registerUser(app, { role: 'BIDDER' })).response.json();
    return { token: body.token, userId: body.user.id };
  }

  function auth(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  function deposit(token: string, amountCents: unknown, key: string | null = randomUUID()) {
    return app.inject({
      method: 'POST',
      url: '/wallet/deposits',
      headers: { ...auth(token), ...(key === null ? {} : { 'idempotency-key': key }) },
      payload: { amountCents },
    });
  }

  async function wallet(token: string) {
    const response = await app.inject({ method: 'GET', url: '/wallet', headers: auth(token) });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  async function movements(token: string) {
    const response = await app.inject({
      method: 'GET',
      url: '/wallet/movements',
      headers: auth(token),
    });
    expect(response.statusCode).toBe(200);
    return response.json().items as { id: string; type: string; amountCents: number }[];
  }

  it('GET /wallet de licitante novo: tudo zero e o teto do depósito', async () => {
    const { token } = await newBidder();
    expect(await wallet(token)).toEqual({
      totalCents: 0,
      committedCents: 0,
      availableCents: 0,
      depositLimitCents: LIMIT_CENTS,
    });
  });

  it('depósito → 201 { movement, wallet }; aumenta total e disponível (disponível = total − comprometido)', async () => {
    const { token } = await newBidder();

    const first = await deposit(token, 150_000);
    expect(first.statusCode).toBe(201);
    expect(first.json()).toEqual({
      movement: {
        id: expect.any(String),
        type: 'DEPOSIT',
        amountCents: 150_000,
        lotId: null,
        createdAt: expect.any(String),
      },
      wallet: {
        totalCents: 150_000,
        committedCents: 0,
        availableCents: 150_000,
        depositLimitCents: LIMIT_CENTS,
      },
    });

    const second = await deposit(token, 2_550);
    expect(second.statusCode).toBe(201);

    const balance = await wallet(token);
    expect(balance.totalCents).toBe(152_550);
    expect(balance.committedCents).toBe(0);
    expect(balance.availableCents).toBe(balance.totalCents - balance.committedCents);
  });

  it('saldo considera COMMIT, RELEASE, DEBIT, CREDIT e REFUND (estorno libera o comprometido)', async () => {
    const { token, userId } = await newBidder();
    await deposit(token, 100_000);
    // Movimentos inseridos direto, para provar a conta do saldo (exemplo 5.3 do contrato).
    await prisma.walletMovement.createMany({
      data: [
        { userId, type: 'COMMIT', amountCents: 30_000 },
        { userId, type: 'COMMIT', amountCents: 50_000 },
        { userId, type: 'RELEASE', amountCents: 30_000 },
        { userId, type: 'DEBIT', amountCents: 50_000 },
        { userId, type: 'RELEASE', amountCents: 50_000 },
        { userId, type: 'CREDIT', amountCents: 7_000 },
      ],
    });

    expect(await wallet(token)).toMatchObject({
      totalCents: 100_000 + 7_000 - 50_000,
      committedCents: 0,
      availableCents: 57_000,
    });

    await prisma.walletMovement.create({ data: { userId, type: 'COMMIT', amountCents: 20_000 } });
    expect(await wallet(token)).toMatchObject({
      totalCents: 57_000,
      committedCents: 20_000,
      availableCents: 37_000,
    });

    // Estorno do lote cancelado (OPC-2): o total não muda e o disponível volta ao de antes do lance.
    await prisma.walletMovement.create({ data: { userId, type: 'REFUND', amountCents: 20_000 } });
    expect(await wallet(token)).toMatchObject({
      totalCents: 57_000,
      committedCents: 0,
      availableCents: 57_000,
    });
  });

  it('T-11: mesma Idempotency-Key 2x → 1 depósito; a segunda devolve 200 com o mesmo movimento', async () => {
    const { token } = await newBidder();
    const key = randomUUID();

    const first = await deposit(token, 40_000, key);
    const again = await deposit(token, 40_000, key);

    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(200);
    expect(again.json().movement).toEqual(first.json().movement);
    expect(again.json().wallet).toEqual({
      totalCents: 40_000,
      committedCents: 0,
      availableCents: 40_000,
      depositLimitCents: LIMIT_CENTS,
    });
    expect(await movements(token)).toHaveLength(1);
  });

  it('a carteira do depósito (201 e 200) tem o mesmo formato do GET /wallet, com o teto', async () => {
    const { token } = await newBidder();
    const key = randomUUID();

    const created = await deposit(token, 12_345, key);
    const replay = await deposit(token, 12_345, key);
    const balance = await wallet(token);

    expect(created.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(Object.keys(balance).sort()).toEqual([
      'availableCents',
      'committedCents',
      'depositLimitCents',
      'totalCents',
    ]);
    expect(created.json().wallet).toEqual(balance);
    expect(replay.json().wallet).toEqual(balance);
  });

  it('T-11: duas requisições simultâneas com a mesma chave → 1 depósito', async () => {
    const { token } = await newBidder();
    const key = randomUUID();

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => deposit(token, 7_000, key)),
    );

    const statuses = responses.map((r) => r.statusCode).sort();
    expect(statuses).toEqual([200, 200, 200, 200, 201]);
    const ids = new Set(responses.map((r) => r.json().movement.id));
    expect(ids.size).toBe(1);
    expect((await wallet(token)).totalCents).toBe(7_000);
    expect(await movements(token)).toHaveLength(1);
  });

  it('a mesma chave em usuários diferentes não colide', async () => {
    const a = await newBidder();
    const b = await newBidder();
    const key = randomUUID();
    expect((await deposit(a.token, 1_000, key)).statusCode).toBe(201);
    expect((await deposit(b.token, 1_000, key)).statusCode).toBe(201);
  });

  it('mesma chave com valor diferente → 409 IDEMPOTENCY_KEY_REUSED, sem novo depósito', async () => {
    const { token } = await newBidder();
    const key = randomUUID();
    await deposit(token, 10_000, key);

    const reused = await deposit(token, 20_000, key);
    expect(reused.statusCode).toBe(409);
    expect(reused.json()).toEqual({
      error: { code: 'IDEMPOTENCY_KEY_REUSED', message: expect.any(String) },
    });
    expect((await wallet(token)).totalCents).toBe(10_000);
  });

  it('acima do teto → 400 com o teto em reais; no teto exato → 201', async () => {
    const { token } = await newBidder();

    const over = await deposit(token, LIMIT_CENTS + 1);
    expect(over.statusCode).toBe(400);
    expect(over.json()).toEqual({
      error: { code: 'DEPOSIT_LIMIT_EXCEEDED', message: expect.stringContaining('R$ 10.000,00') },
    });

    expect((await deposit(token, LIMIT_CENTS)).statusCode).toBe(201);
    expect((await wallet(token)).totalCents).toBe(LIMIT_CENTS);
  });

  it('valor ≤ 0, fracionado ou não numérico → 400 VALIDATION_ERROR', async () => {
    const { token } = await newBidder();
    for (const amount of [0, -100, 10.5, '1000', null]) {
      const response = await deposit(token, amount);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    }
    expect(await movements(token)).toHaveLength(0);
  });

  it('sem Idempotency-Key ou com chave curta/longa → 400', async () => {
    const { token } = await newBidder();
    for (const key of [null, 'curta', 'x'.repeat(129)]) {
      const response = await deposit(token, 1_000, key);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    }
    expect(await movements(token)).toHaveLength(0);
  });

  it('extrato: uma linha por depósito, mais recentes primeiro', async () => {
    const { token } = await newBidder();
    // createdAt tem resolução de milissegundo: espaça os depósitos para a ordem ser determinística.
    for (const amount of [1_000, 2_000, 3_000]) {
      await deposit(token, amount);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const items = await movements(token);
    expect(items.map((item) => item.amountCents)).toEqual([3_000, 2_000, 1_000]);
    expect(items[0]).toEqual({
      id: expect.any(String),
      type: 'DEPOSIT',
      amountCents: 3_000,
      lotId: null,
      createdAt: expect.any(String),
    });
    const sum = items.reduce((total, item) => total + item.amountCents, 0);
    expect((await wallet(token)).totalCents).toBe(sum);
  });

  it('extrato é por usuário: não mostra movimentos de outro licitante', async () => {
    const a = await newBidder();
    const b = await newBidder();
    await deposit(a.token, 5_000);
    expect(await movements(b.token)).toEqual([]);
  });

  it('LEILOEIRO → 403 FORBIDDEN e sem token → 401 UNAUTHORIZED em todas as rotas', async () => {
    const auctioneer = (await registerUser(app, { role: 'AUCTIONEER' })).response.json();
    const routes = [
      { method: 'GET', url: '/wallet' },
      { method: 'POST', url: '/wallet/deposits', payload: { amountCents: 1_000 } },
      { method: 'GET', url: '/wallet/movements' },
    ] as const;

    for (const route of routes) {
      const forbidden = await app.inject({
        ...route,
        headers: { ...auth(auctioneer.token), 'idempotency-key': randomUUID() },
      });
      expect(forbidden.statusCode).toBe(403);
      expect(forbidden.json()).toEqual({
        error: { code: 'FORBIDDEN', message: expect.any(String) },
      });

      const anonymous = await app.inject({
        ...route,
        headers: { 'idempotency-key': randomUUID() },
      });
      expect(anonymous.statusCode).toBe(401);
      expect(anonymous.json().error.code).toBe('UNAUTHORIZED');
    }
    expect(await prisma.walletMovement.count({ where: { userId: auctioneer.user.id } })).toBe(0);
  });

  it('seed: licitante-1 e licitante-2 têm o depósito inicial de R$ 5.000,00, uma vez só', async () => {
    for (const email of ['licitante-1@stonebid.dev', 'licitante-2@stonebid.dev']) {
      const rows = await prisma.walletMovement.findMany({
        where: { user: { email }, idempotencyKey: `seed-deposit-${email}` },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ type: 'DEPOSIT', amountCents: 500_000 });
    }
  });
});

describe('carteira pela camada MCP', () => {
  let app: FastifyInstance;
  let client: Client;

  interface ToolPayload {
    status: number;
    body: Record<string, unknown>;
  }

  const payloadOf = (result: Awaited<ReturnType<Client['callTool']>>) =>
    result.structuredContent as unknown as ToolPayload;

  beforeAll(async () => {
    app = await buildApp({ mcpEnabled: true });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    client = new Client({ name: 'stonebid-e2e', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
        requestInit: { headers: { 'x-api-key': testEnv.MCP_API_KEY } },
      }),
    );
  });

  afterAll(async () => {
    await client.close();
    await app.close();
    await prisma.$disconnect();
  });

  it('wallet_get, wallet_deposit (idempotente) e wallet_movements passam pelas rotas reais', async () => {
    await client.callTool({ name: 'entrar', arguments: { user: 'licitante-1' } });

    const before = payloadOf(await client.callTool({ name: 'wallet_get', arguments: {} }));
    expect(before.status).toBe(200);
    const totalBefore = before.body.totalCents as number;
    expect(totalBefore).toBeGreaterThanOrEqual(500_000);

    const idempotencyKey = `mcp-e2e-${randomUUID()}`;
    const args = { amountCents: 1_234, idempotencyKey };
    const created = payloadOf(await client.callTool({ name: 'wallet_deposit', arguments: args }));
    const replay = payloadOf(await client.callTool({ name: 'wallet_deposit', arguments: args }));
    expect(created.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body.movement).toEqual(created.body.movement);
    // Mesmo formato do wallet_get (GET /wallet), com o teto, no 201 e no 200.
    const walletShape = {
      totalCents: totalBefore + 1_234,
      committedCents: expect.any(Number),
      availableCents: expect.any(Number),
      depositLimitCents: before.body.depositLimitCents,
    };
    expect(before.body.depositLimitCents).toEqual(expect.any(Number));
    expect(created.body.wallet).toEqual(walletShape);
    expect(replay.body.wallet).toEqual(walletShape);

    const after = payloadOf(await client.callTool({ name: 'wallet_get', arguments: {} }));
    expect(after.body.totalCents).toBe(totalBefore + 1_234);

    const extrato = payloadOf(await client.callTool({ name: 'wallet_movements', arguments: {} }));
    const items = extrato.body.items as { id: string }[];
    expect(items[0]?.id).toBe((created.body.movement as { id: string }).id);

    // Limpa o depósito de teste do licitante do seed (só o teste apaga; a aplicação nunca).
    await prisma.walletMovement.deleteMany({ where: { idempotencyKey } });
  });

  it('leiloeiro na tool da carteira → isError com 403', async () => {
    await client.callTool({ name: 'entrar', arguments: { user: 'leiloeiro' } });
    const result = await client.callTool({ name: 'wallet_get', arguments: {} });
    expect(result.isError).toBe(true);
    expect(payloadOf(result)).toMatchObject({
      status: 403,
      body: { error: { code: 'FORBIDDEN' } },
    });
  });
});
