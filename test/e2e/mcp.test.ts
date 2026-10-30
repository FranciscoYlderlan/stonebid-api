import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { prisma } from '../../src/infra/repositories/prisma/prisma-client.ts';
import { testEnv } from '../test-env.ts';
import { uniqueEmail } from './helpers.ts';
import { MOCK_IMAGE, startItemsApiMock, type ItemsApiMock } from './items-api-mock.ts';

interface ToolPayload {
  status: number;
  body: Record<string, unknown>;
}

function payloadOf(result: Awaited<ReturnType<Client['callTool']>>): ToolPayload {
  return result.structuredContent as unknown as ToolPayload;
}

describe('camada MCP (/mcp)', () => {
  let app: FastifyInstance;
  let mcpUrl: URL;
  let itemsApi: ItemsApiMock;

  async function connect(headers: Record<string, string>): Promise<Client> {
    const client = new Client({ name: 'stonebid-e2e', version: '0.0.0' });
    const transport = new StreamableHTTPClientTransport(mcpUrl, { requestInit: { headers } });
    await client.connect(transport);
    return client;
  }

  beforeAll(async () => {
    itemsApi = await startItemsApiMock();
    app = await buildApp({ mcpEnabled: true, itemCatalog: itemsApi.catalog });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    mcpUrl = new URL(`http://127.0.0.1:${port}/mcp`);
  });

  afterAll(async () => {
    await app.close();
    await itemsApi.close();
    await prisma.$disconnect();
  });

  it('sem api_key → 401', async () => {
    const response = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: expect.any(String) },
    });
  });

  it('api_key errada → 401 (x-api-key e Authorization: Bearer)', async () => {
    for (const headers of [{ 'x-api-key': 'chave-errada' }, { authorization: 'Bearer errada' }]) {
      const response = await fetch(mcpUrl, { method: 'POST', headers });
      expect(response.status).toBe(401);
    }
    await expect(connect({ 'x-api-key': 'chave-errada' })).rejects.toThrow();
  });

  it('lista as tools da camada', async () => {
    const client = await connect({ 'x-api-key': testEnv.MCP_API_KEY });
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'auctioneer_lots',
      'auth_login',
      'auth_me',
      'auth_register',
      'bids_list',
      'bids_mine',
      'bids_place',
      'entrar',
      'health',
      'items_search',
      'lots_cancel',
      'lots_create',
      'lots_get',
      'lots_list',
      'receipts_get',
      'wallet_deposit',
      'wallet_get',
      'wallet_movements',
    ]);
    await client.close();
  });

  it('entrar + auth_me agem como o usuário de teste escolhido', async () => {
    // api_key também aceita no Authorization: Bearer
    const client = await connect({ authorization: `Bearer ${testEnv.MCP_API_KEY}` });

    const before = payloadOf(await client.callTool({ name: 'auth_me', arguments: {} }));
    expect(before.status).toBe(401);

    const signedIn = await client.callTool({ name: 'entrar', arguments: { user: 'leiloeiro' } });
    expect(signedIn.isError).toBe(false);
    expect(payloadOf(signedIn).body).toEqual({
      user: expect.objectContaining({ email: 'leiloeiro@stonebid.dev', role: 'AUCTIONEER' }),
    });
    expect(JSON.stringify(signedIn)).not.toContain('token');

    const me = payloadOf(await client.callTool({ name: 'auth_me', arguments: {} }));
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ email: 'leiloeiro@stonebid.dev', role: 'AUCTIONEER' });

    // Trocar de usuário é chamar entrar de novo.
    await client.callTool({ name: 'entrar', arguments: { user: 'licitante-2' } });
    const me2 = payloadOf(await client.callTool({ name: 'auth_me', arguments: {} }));
    expect(me2.body.user).toMatchObject({ email: 'licitante-2@stonebid.dev', role: 'BIDDER' });

    await client.close();
  });

  it('sessões MCP são independentes', async () => {
    const a = await connect({ 'x-api-key': testEnv.MCP_API_KEY });
    const b = await connect({ 'x-api-key': testEnv.MCP_API_KEY });

    await a.callTool({ name: 'entrar', arguments: { user: 'licitante-1' } });
    const meB = payloadOf(await b.callTool({ name: 'auth_me', arguments: {} }));
    expect(meB.status).toBe(401);

    await a.close();
    await b.close();
  });

  it('health, auth_register e auth_login passam pelas rotas reais', async () => {
    const client = await connect({ 'x-api-key': testEnv.MCP_API_KEY });

    const health = payloadOf(await client.callTool({ name: 'health', arguments: {} }));
    expect(health).toEqual({ status: 200, body: { status: 'ok' } });

    const email = uniqueEmail('mcp');
    const registered = payloadOf(
      await client.callTool({
        name: 'auth_register',
        arguments: { name: 'Via MCP', email, password: 'senha-forte-123', role: 'BIDDER' },
      }),
    );
    expect(registered.status).toBe(201);

    const wrong = await client.callTool({
      name: 'auth_login',
      arguments: { email, password: 'senha-errada-000' },
    });
    expect(wrong.isError).toBe(true);
    expect(payloadOf(wrong)).toMatchObject({
      status: 401,
      body: { error: { code: 'INVALID_CREDENTIALS' } },
    });

    await client.close();
  });
});

describe('camada MCP: tools de itens e lotes', () => {
  let app: FastifyInstance;
  let mcpUrl: URL;
  let itemsApi: ItemsApiMock;

  beforeAll(async () => {
    itemsApi = await startItemsApiMock();
    app = await buildApp({ mcpEnabled: true, itemCatalog: itemsApi.catalog });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    mcpUrl = new URL(`http://127.0.0.1:${port}/mcp`);
  });

  afterAll(async () => {
    await app.close();
    await itemsApi.close();
    await prisma.$disconnect();
  });

  it('leiloeiro busca, cria, consulta e cancela; licitante não cancela', async () => {
    const client = new Client({ name: 'stonebid-e2e', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(mcpUrl, {
        requestInit: { headers: { 'x-api-key': testEnv.MCP_API_KEY } },
      }),
    );
    const call = async (name: string, args: Record<string, unknown> = {}) =>
      payloadOf(await client.callTool({ name, arguments: args }));

    expect((await call('items_search', { q: 'paisagem' })).status).toBe(401);

    await call('entrar', { user: 'leiloeiro' });
    const search = await call('items_search', { q: 'paisagem', page: 1 });
    expect(search.status).toBe(200);
    const [item] = search.body.items as { externalId: string }[];

    const created = await call('lots_create', {
      externalId: item?.externalId,
      startingBidCents: 20_000,
      minIncrementCents: 1_000,
      startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('SCHEDULED');
    const id = created.body.id as string;

    // RN-19: a mesma obra não ganha outro lote; a busca mostra a situação.
    const again = await call('lots_create', {
      externalId: item?.externalId,
      startingBidCents: 20_000,
      minIncrementCents: 1_000,
      startsAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      endsAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    });
    expect(again).toMatchObject({
      status: 409,
      body: {
        error: { code: 'ITEM_ALREADY_AUCTIONED', details: { status: 'SCHEDULED', lotId: id } },
      },
    });
    const searchAgain = await call('items_search', { q: 'paisagem', page: 1 });
    expect((searchAgain.body.items as { auction: unknown }[])[0]?.auction).toEqual({
      status: 'SCHEDULED',
      lotId: id,
    });

    const got = await call('lots_get', { id });
    expect(got).toMatchObject({ status: 200, body: { lot: { id, status: 'SCHEDULED' } } });

    const list = await call('lots_list');
    expect((list.body.scheduled as { id: string }[]).map((lot) => lot.id)).toContain(id);

    const mine = await call('auctioneer_lots');
    expect((mine.body.items as { id: string }[]).map((lot) => lot.id)).toContain(id);

    await call('entrar', { user: 'licitante-1' });
    const forbidden = await client.callTool({
      name: 'lots_cancel',
      arguments: { id, reason: 'Motivo de teste' },
    });
    expect(forbidden.isError).toBe(true);
    expect(payloadOf(forbidden).status).toBe(403);

    await call('entrar', { user: 'leiloeiro' });
    const canceled = await call('lots_cancel', { id, reason: 'Obra retirada' });
    expect(canceled).toMatchObject({ status: 200, body: { id, status: 'CANCELED' } });

    await client.close();
  });
});

describe('camada MCP: tools de lances', () => {
  let app: FastifyInstance;
  let mcpUrl: URL;

  beforeAll(async () => {
    app = await buildApp({ mcpEnabled: true });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    mcpUrl = new URL(`http://127.0.0.1:${port}/mcp`);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('licitante dá lance e repete a chave; leiloeiro recebe 403; histórico com pseudônimo', async () => {
    const auctioneer = await prisma.user.findUniqueOrThrow({
      where: { email: 'leiloeiro@stonebid.dev' },
    });
    const lot = await prisma.lot.create({
      data: {
        auctioneerId: auctioneer.id,
        externalId: `lance-mcp-${randomUUID()}`,
        title: 'Lote MCP',
        attributes: {},
        imageData: new Uint8Array(MOCK_IMAGE),
        imageContentType: 'image/png',
        startingBidCents: 1_000,
        minIncrementCents: 100,
        startsAt: new Date(Date.now() - 60 * 1000),
        originalEndsAt: new Date(Date.now() + 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const client = new Client({ name: 'stonebid-e2e', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(mcpUrl, {
        requestInit: { headers: { 'x-api-key': testEnv.MCP_API_KEY } },
      }),
    );
    const call = async (name: string, args: Record<string, unknown> = {}) =>
      payloadOf(await client.callTool({ name, arguments: args }));

    await call('entrar', { user: 'leiloeiro' });
    const forbidden = await call('bids_place', {
      id: lot.id,
      amountCents: 1_000,
      idempotencyKey: randomUUID(),
    });
    expect(forbidden).toMatchObject({ status: 403, body: { error: { code: 'FORBIDDEN' } } });

    await call('entrar', { user: 'licitante-1' });
    const key = randomUUID();
    const placed = await call('bids_place', {
      id: lot.id,
      amountCents: 1_000,
      idempotencyKey: key,
    });
    expect(placed).toMatchObject({
      status: 201,
      body: { bid: { seq: 1, amountCents: 1_000 }, lot: { minNextBidCents: 1_100 } },
    });
    const replay = await call('bids_place', {
      id: lot.id,
      amountCents: 1_000,
      idempotencyKey: key,
    });
    expect(replay.status).toBe(200);

    const below = await call('bids_place', {
      id: lot.id,
      amountCents: 1_050,
      idempotencyKey: randomUUID(),
    });
    expect(below).toMatchObject({
      status: 409,
      body: { error: { code: 'ALREADY_WINNING' } },
    });

    const list = await call('bids_list', { id: lot.id });
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([
      {
        seq: 1,
        amountCents: 1_000,
        pseudonym: expect.stringMatching(/^Licitante [0-9A-F]{6}$/),
        createdAt: expect.any(String),
      },
    ]);

    await client.close();
  });
});

describe('camada MCP: tools do I3 (comprovante, meus lances, total, cancelamento com motivo)', () => {
  let app: FastifyInstance;
  let mcpUrl: URL;

  beforeAll(async () => {
    app = await buildApp({ mcpEnabled: true });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    mcpUrl = new URL(`http://127.0.0.1:${port}/mcp`);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('receipts_get, bids_mine, auctioneer_lots com total e lots_cancel exigindo reason', async () => {
    const client = new Client({ name: 'stonebid-e2e', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(mcpUrl, {
        requestInit: { headers: { 'x-api-key': testEnv.MCP_API_KEY } },
      }),
    );
    const call = async (name: string, args: Record<string, unknown> = {}) =>
      payloadOf(await client.callTool({ name, arguments: args }));

    // O seed deixa o seed-3 liquidado, com comprovante (licitante-2 vence).
    const seeded = await call('lots_get', { id: '5eed0000-0000-4000-8000-000000000003' });
    expect(seeded).toMatchObject({
      status: 200,
      body: { lot: { status: 'ENDED', result: 'SOLD', viewer: null } },
    });
    const publicId = (seeded.body.lot as { receiptPublicId: string }).receiptPublicId;
    const receipt = await call('receipts_get', { publicId });
    expect(receipt).toMatchObject({
      status: 200,
      body: {
        receipt: {
          publicId,
          finalAmountCents: 35_000,
          winnerPseudonym: expect.stringMatching(/^Licitante [0-9A-F]{6}$/),
          auditPath: '/lots/5eed0000-0000-4000-8000-000000000003/audit',
        },
      },
    });
    expect((await call('receipts_get', { publicId: 'AAAAAAAAAAAAAAAAAAAAAA' })).status).toBe(404);

    await call('entrar', { user: 'licitante-2' });
    const mine = await call('bids_mine');
    expect(mine.status).toBe(200);
    const won = (
      mine.body.items as { lot: { id: string }; position: string; receiptPublicId: string }[]
    ).find((item) => item.lot.id === '5eed0000-0000-4000-8000-000000000003');
    expect(won).toMatchObject({
      position: 'WON',
      receiptPublicId: publicId,
      myMaxBidCents: 35_000,
    });
    // Licitante logado: lots_get traz o pseudônimo dele (o vencedor do seed-3).
    const asWinner = await call('lots_get', { id: '5eed0000-0000-4000-8000-000000000003' });
    const winnerLot = asWinner.body.lot as {
      viewer: { pseudonym: string };
      leaderPseudonym: string;
    };
    expect(winnerLot.viewer.pseudonym).toBe(winnerLot.leaderPseudonym);

    await call('entrar', { user: 'leiloeiro' });
    const lots = await call('auctioneer_lots');
    expect(lots.status).toBe(200);
    expect(lots.body.totalReceivedCents).toEqual(expect.any(Number));
    expect(lots.body.totalReceivedCents as number).toBeGreaterThanOrEqual(35_000);
    expect((await call('bids_mine')).status).toBe(403);

    const auctioneer = await prisma.user.findUniqueOrThrow({
      where: { email: 'leiloeiro@stonebid.dev' },
    });
    const lot = await prisma.lot.create({
      data: {
        auctioneerId: auctioneer.id,
        externalId: `cancel-mcp-${randomUUID()}`,
        title: 'Lote MCP cancelamento',
        attributes: {},
        imageData: new Uint8Array(MOCK_IMAGE),
        imageContentType: 'image/png',
        startingBidCents: 1_000,
        minIncrementCents: 100,
        startsAt: new Date(Date.now() + 60 * 60 * 1000),
        originalEndsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      },
    });
    const short = await call('lots_cancel', { id: lot.id, reason: 'x' });
    expect(short).toMatchObject({ status: 422, body: { error: { code: 'VALIDATION_ERROR' } } });
    const canceled = await call('lots_cancel', { id: lot.id, reason: 'Obra retirada' });
    expect(canceled).toMatchObject({
      status: 200,
      body: { status: 'CANCELED', cancelReason: 'Obra retirada' },
    });

    await client.close();
  });
});

describe('camada MCP desligada', () => {
  it('sem MCP_ENABLED a rota /mcp não existe', async () => {
    const app = await buildApp({ mcpEnabled: false });
    const response = await app.inject({ method: 'POST', url: '/mcp' });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
