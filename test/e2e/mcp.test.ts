import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { prisma } from '../../src/infra/repositories/prisma/prisma-client.ts';
import { testEnv } from '../test-env.ts';
import { uniqueEmail } from './helpers.ts';
import { startItemsApiMock, type ItemsApiMock } from './items-api-mock.ts';

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
      'entrar',
      'health',
      'items_search',
      'lots_cancel',
      'lots_create',
      'lots_get',
      'lots_list',
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

    const got = await call('lots_get', { id });
    expect(got).toMatchObject({ status: 200, body: { lot: { id, status: 'SCHEDULED' } } });

    const list = await call('lots_list');
    expect((list.body.scheduled as { id: string }[]).map((lot) => lot.id)).toContain(id);

    const mine = await call('auctioneer_lots');
    expect((mine.body.items as { id: string }[]).map((lot) => lot.id)).toContain(id);

    await call('entrar', { user: 'licitante-1' });
    const forbidden = await client.callTool({ name: 'lots_cancel', arguments: { id } });
    expect(forbidden.isError).toBe(true);
    expect(payloadOf(forbidden).status).toBe(403);

    await call('entrar', { user: 'leiloeiro' });
    const canceled = await call('lots_cancel', { id });
    expect(canceled).toMatchObject({ status: 200, body: { id, status: 'CANCELED' } });

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
