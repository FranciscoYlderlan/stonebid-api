import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, RATE_LIMIT_EXPOSED_HEADERS, TRUSTED_PROXY } from '../../src/app.ts';
import { THUMBNAIL_RATE_LIMIT } from '../../src/infra/http/routes/items-routes.ts';
import {
  IMG_900001,
  IMG_900003,
  IMG_BIG,
  MOCK_IMAGE,
  startItemsApiMock,
  type ItemsApiMock,
} from './items-api-mock.ts';

const thumbnailUrl = (imageId: string) => `/items/images/${imageId}/thumbnail`;
const iiifCalls = (mock: ItemsApiMock) =>
  mock.requests.filter((request) => request.url.startsWith('/iiif/2/'));

describe('GET /items/images/:imageId/thumbnail: cache e limite (RF-20, T5g)', () => {
  let app: FastifyInstance;
  let mock: ItemsApiMock;

  beforeAll(async () => {
    mock = await startItemsApiMock(300);
    app = await buildApp({ itemCatalog: mock.catalog });
    await app.ready();
  });

  beforeEach(() => {
    mock.setMode('ok');
    mock.requests.length = 0;
  });

  afterAll(async () => {
    await app.close();
    await mock.close();
  });

  it('o mesmo id sai do cache na segunda vez, sem nova ida à AIC (maiúsculas incluídas)', async () => {
    const first = await app.inject({ method: 'GET', url: thumbnailUrl(IMG_900001) });
    const second = await app.inject({ method: 'GET', url: thumbnailUrl(IMG_900001) });
    const upper = await app.inject({ method: 'GET', url: thumbnailUrl(IMG_900001.toUpperCase()) });

    for (const response of [first, second, upper]) {
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('image/png');
      expect(response.headers['cache-control']).toBe('public, max-age=604800, immutable');
      expect(Buffer.compare(response.rawPayload, MOCK_IMAGE)).toBe(0);
    }
    expect(iiifCalls(mock)).toHaveLength(1);
  });

  it('pedidos simultâneos do mesmo id fazem uma só busca na AIC', async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => app.inject({ method: 'GET', url: thumbnailUrl(IMG_900003) })),
    );
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200, 200, 200]);
    expect(iiifCalls(mock)).toHaveLength(1);
  });

  it('pedidos simultâneos com a AIC fora do ar: uma busca, todos 502, nada no cache', async () => {
    mock.setMode('down');
    const responses = await Promise.all(
      Array.from({ length: 3 }, () => app.inject({ method: 'GET', url: thumbnailUrl(IMG_BIG) })),
    );
    expect(responses.map((response) => response.statusCode)).toEqual([502, 502, 502]);
    expect(iiifCalls(mock)).toHaveLength(1);

    mock.setMode('ok');
    const retry = await app.inject({ method: 'GET', url: thumbnailUrl(IMG_BIG) });
    expect(retry.statusCode).toBe(200);
    expect(iiifCalls(mock)).toHaveLength(2);
  });

  it('acima do limite por IP → 429 TOO_MANY_REQUESTS só nessa rota', async () => {
    const otherIp = '203.0.113.7';
    // Id inválido: conta no limite (o limite roda antes da validação) sem ir à AIC.
    const invalid = { method: 'GET' as const, url: thumbnailUrl('x'), remoteAddress: otherIp };
    for (let i = 0; i < THUMBNAIL_RATE_LIMIT.max; i += 1) {
      const response = await app.inject(invalid);
      expect(response.statusCode).toBe(400);
    }

    const limited = await app.inject({ ...invalid, url: thumbnailUrl(IMG_900001) });
    expect(limited.statusCode).toBe(429);
    const retryAfter = Number(limited.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(1);
    expect(limited.json()).toEqual({
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: `Muitas requisições. Tente de novo em ${retryAfter} segundos.`,
      },
    });
    expect(limited.headers['cache-control']).toBeUndefined();

    // Outras rotas, mesmo IP: sem limite.
    const health = await app.inject({ method: 'GET', url: '/health', remoteAddress: otherIp });
    expect(health.statusCode).not.toBe(429);
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {},
      remoteAddress: otherIp,
    });
    expect(login.statusCode).toBe(400);

    // Outro IP segue livre na mesma rota.
    const otherClient = await app.inject({ method: 'GET', url: thumbnailUrl(IMG_900001) });
    expect(otherClient.statusCode).toBe(200);
  });
});

describe('GET /items/images/:imageId/thumbnail: cabeçalhos do limite legíveis pelo navegador (T5k)', () => {
  const origin = 'http://localhost:5173';
  let app: FastifyInstance;
  let mock: ItemsApiMock;

  beforeAll(async () => {
    mock = await startItemsApiMock(300);
    app = await buildApp({ itemCatalog: mock.catalog });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await mock.close();
  });

  const exposed = (header: string | string[] | number | undefined) =>
    String(header ?? '')
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean)
      .sort();

  it('o 429 com Origin permitido expõe retry-after e x-ratelimit-*, e só eles', async () => {
    const client = '198.51.100.40';
    const invalid = {
      method: 'GET' as const,
      url: thumbnailUrl('x'),
      remoteAddress: client,
      headers: { origin },
    };
    for (let i = 0; i < THUMBNAIL_RATE_LIMIT.max; i += 1) {
      const response = await app.inject(invalid);
      expect(response.statusCode).toBe(400);
    }

    const limited = await app.inject(invalid);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('TOO_MANY_REQUESTS');
    expect(limited.headers['access-control-allow-origin']).toBe(origin);
    expect(exposed(limited.headers['access-control-expose-headers'])).toEqual(
      [...RATE_LIMIT_EXPOSED_HEADERS].sort(),
    );
    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.headers['x-ratelimit-limit']).toBe(String(THUMBNAIL_RATE_LIMIT.max));
  });

  // O @fastify/cors manda o Expose-Headers mesmo sem liberar a origem; sem Allow-Origin, o navegador
  // bloqueia a resposta inteira e não lê cabeçalho nenhum.
  it('Origin não permitido não ganha Access-Control-Allow-Origin', async () => {
    const response = await app.inject({
      method: 'GET',
      url: thumbnailUrl('x'),
      remoteAddress: '198.51.100.41',
      headers: { origin: 'https://malicioso.example' },
    });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('GET /items/images/:imageId/thumbnail: IP real atrás do proxy do Cloud Run (T5h)', () => {
  // Endereço do proxy interno do Cloud Run, dentro de TRUSTED_PROXY.
  const proxy = '169.254.1.1';
  let app: FastifyInstance;
  let mock: ItemsApiMock;

  beforeAll(async () => {
    expect(TRUSTED_PROXY).toBe('169.254.0.0/16');
    mock = await startItemsApiMock(300);
    app = await buildApp({ itemCatalog: mock.catalog });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await mock.close();
  });

  // Id inválido: conta no limite (o limite roda antes da validação) sem ir à AIC.
  const hit = (remoteAddress: string, forwardedFor?: string) =>
    app.inject({
      method: 'GET',
      url: thumbnailUrl('x'),
      remoteAddress,
      headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
    });

  const exhaust = async (remoteAddress: string, forwardedFor?: string) => {
    for (let i = 0; i < THUMBNAIL_RATE_LIMIT.max; i += 1) {
      const response = await hit(remoteAddress, forwardedFor);
      expect(response.statusCode).toBe(400);
    }
    expect((await hit(remoteAddress, forwardedFor)).statusCode).toBe(429);
  };

  it('dois clientes pelo mesmo proxy têm baldes separados', async () => {
    await exhaust(proxy, '198.51.100.10');
    expect((await hit(proxy, '198.51.100.11')).statusCode).toBe(400);
  });

  it('X-Forwarded-For falso do cliente não tira ele do próprio balde', async () => {
    const client = '198.51.100.20';
    await exhaust(proxy, client);
    // O Google Front End acrescenta o IP real no fim; o valor inventado fica à esquerda.
    expect((await hit(proxy, `203.0.113.99, ${client}`)).statusCode).toBe(429);
    expect((await hit(proxy, `169.254.9.9, ${client}`)).statusCode).toBe(429);
  });

  it('conexão fora do proxy confiável ignora o X-Forwarded-For', async () => {
    const direct = '192.0.2.30';
    await exhaust(direct, '198.51.100.30');
    expect((await hit(direct, '198.51.100.31')).statusCode).toBe(429);
    expect((await hit(direct)).statusCode).toBe(429);
  });
});
